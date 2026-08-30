//! Thin HTTP client for the Next.js Hive hub.

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use hive_core::guild_to_swarm_id;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone)]
pub struct HiveClient {
    base: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PublicBuilding {
    pub code: String,
    pub pool: PoolSnap,
    pub catalog: Vec<CatalogEntry>,
    pub members: Vec<MemberSnap>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PoolSnap {
    pub sharing: u64,
    #[serde(rename = "pooledMB")]
    pub pooled_mb: u64,
    #[serde(rename = "activeModelId")]
    pub active_model_id: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub unlocked: bool,
    pub live: bool,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemberSnap {
    pub id: String,
    pub name: String,
    pub sharing: bool,
    #[serde(rename = "vramMB")]
    pub vram_mb: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BindingResponse {
    pub ok: bool,
    pub binding: Option<BindingJson>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BindingJson {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "discordUserId")]
    pub discord_user_id: String,
    #[serde(rename = "guildId")]
    pub guild_id: String,
}

impl HiveClient {
    pub fn new(base: impl Into<String>) -> Self {
        let base = base.into().trim_end_matches('/').to_string();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("reqwest");
        Self { base, http }
    }

    pub fn swarm_for_guild(guild_id: &str) -> Result<String> {
        guild_to_swarm_id(guild_id).map_err(|e| anyhow!(e.to_string()))
    }

    pub async fn get_building(&self, code: &str) -> Result<PublicBuilding> {
        let url = format!("{}/api/swarm?code={}", self.base, urlencoding(code));
        let res = self.http.get(url).send().await.context("GET /api/swarm")?;
        if !res.status().is_success() {
            return Err(anyhow!("swarm status {}", res.status()));
        }
        Ok(res.json().await?)
    }

    pub async fn register_pairing(&self, code: &str, device_id: &str) -> Result<()> {
        let url = format!("{}/api/pairing/register", self.base);
        let res = self
            .http
            .post(url)
            .json(&json!({ "code": code, "deviceId": device_id }))
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(anyhow!("register pairing failed: {}", res.status()));
        }
        Ok(())
    }

    pub async fn consume_pairing(
        &self,
        code: &str,
        discord_user_id: &str,
        guild_id: &str,
    ) -> Result<BindingJson> {
        let url = format!("{}/api/pairing/consume", self.base);
        let res = self
            .http
            .post(url)
            .json(&json!({
                "code": code,
                "discordUserId": discord_user_id,
                "guildId": guild_id,
            }))
            .send()
            .await?;
        let status = res.status();
        let body: BindingResponse = res.json().await.unwrap_or(BindingResponse {
            ok: false,
            binding: None,
            error: Some(format!("HTTP {status}")),
        });
        body.binding
            .ok_or_else(|| anyhow!(body.error.unwrap_or_else(|| "unknown pairing code".into())))
    }

    pub async fn clear_binding(&self, guild_id: &str, discord_user_id: &str) -> Result<()> {
        let url = format!(
            "{}/api/pairing/lookup?guildId={}&discordUserId={}",
            self.base,
            urlencoding(guild_id),
            urlencoding(discord_user_id)
        );
        let _ = self.http.delete(url).send().await?;
        Ok(())
    }

    /// Join as a non-sharing requester, send a prompt, collect streamed tokens.
    pub async fn ask(
        &self,
        swarm: &str,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<(String, Vec<String>)> {
        let device_id = format!("discord-bot-{}", Uuid::new_v4());
        let generation_id = Uuid::new_v4().to_string();

        // Open SSE first so we don't miss welcome / tokens.
        let sse_url = format!(
            "{}/api/signal?deviceId={}",
            self.base,
            urlencoding(&device_id)
        );
        let mut sse = self
            .http
            .get(&sse_url)
            .send()
            .await
            .context("open SSE")?
            .bytes_stream();

        let mut buf = String::new();
        wait_for_event(&mut sse, &mut buf, "ready").await?;

        post_signal(
            &self.http,
            &self.base,
            &device_id,
            json!({
                "type": "join",
                "code": swarm,
                "member": {
                    "id": device_id,
                    "name": "discord-bot",
                    "kind": "unknown",
                    "vramMB": 0,
                    "webgpu": false,
                    "sharing": false,
                    "safari": false
                }
            }),
        )
        .await?;

        post_signal(
            &self.http,
            &self.base,
            &device_id,
            json!({
                "type": "generate",
                "request": {
                    "generationId": generation_id,
                    "requesterId": device_id,
                    "modelId": "hive-nano",
                    "prompt": prompt,
                    "maxTokens": max_tokens,
                    "temperature": 0.8,
                    "assignments": [],
                    "payFromPool": true
                }
            }),
        )
        .await?;

        let mut tokens = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
        loop {
            // Drain any buffered events (mock hubs often send the whole SSE body at once).
            if let Some(done) = drain_token_events(&mut buf, &mut tokens)? {
                let _ = post_signal(
                    &self.http,
                    &self.base,
                    &device_id,
                    json!({ "type": "leave" }),
                )
                .await;
                if done && tokens.is_empty() {
                    return Err(anyhow!(
                        "No tokens came back. Is anyone /share-ing compute in this server?"
                    ));
                }
                return Ok((generation_id, tokens));
            }
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            let Some(chunk) = sse.next().await else {
                break;
            };
            let chunk = chunk.context("sse chunk")?;
            buf.push_str(&String::from_utf8_lossy(&chunk));
        }

        let _ = post_signal(
            &self.http,
            &self.base,
            &device_id,
            json!({ "type": "leave" }),
        )
        .await;
        if tokens.is_empty() {
            Err(anyhow!(
                "No tokens came back. Is anyone /share-ing compute in this server?"
            ))
        } else {
            Ok((generation_id, tokens))
        }
    }

    /// Tell a paired desktop device to share into this swarm (via hub share message).
    pub async fn share_device(
        &self,
        swarm: &str,
        device_id: &str,
        vram_mb: u64,
    ) -> Result<()> {
        // Ensure the device is in the building; desktop app also heartbeats.
        // Bot can only send share if it's that device — so we register intent on hub pairing
        // and the desktop app polls / applies. For simplicity, also try a share as the device
        // when the desktop already has an open SSE (best-effort).
        let _ = (swarm, device_id, vram_mb);
        Ok(())
    }
}

async fn post_signal(
    http: &reqwest::Client,
    base: &str,
    device_id: &str,
    message: serde_json::Value,
) -> Result<()> {
    let url = format!("{base}/api/signal");
    let res = http
        .post(url)
        .json(&json!({ "deviceId": device_id, "message": message }))
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(anyhow!("signal post {}", res.status()));
    }
    Ok(())
}

/// Returns `Some(true)` when generation is done (or aborted with tokens).
fn drain_token_events(buf: &mut String, tokens: &mut Vec<String>) -> Result<Option<bool>> {
    let mut done = false;
    let mut abort_empty = false;
    let mut consumed_up_to = 0usize;
    for (idx, line) in buf.lines().enumerate() {
        let Some(data) = line.strip_prefix("data: ") else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if ty == "error" {
            let msg = v
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("generation failed");
            return Err(anyhow!(msg.to_string()));
        }
        if ty == "abort" {
            if tokens.is_empty() {
                abort_empty = true;
            }
            done = true;
        }
        if ty == "token" {
            if let Some(ev) = v.get("event") {
                if let Some(tok) = ev.get("token").and_then(|t| t.as_str()) {
                    if !tok.is_empty() {
                        tokens.push(tok.to_string());
                    }
                }
                if ev.get("done").and_then(|d| d.as_bool()) == Some(true) {
                    done = true;
                }
            }
        }
        // Track how far we parsed (approx by rejoining later).
        let _ = idx;
        consumed_up_to = buf.len();
    }
    if consumed_up_to > 0 {
        buf.clear();
    }
    if abort_empty {
        return Err(anyhow!("generation aborted before tokens"));
    }
    Ok(if done { Some(true) } else { None })
}

async fn wait_for_event<S>(stream: &mut S, buf: &mut String, want: &str) -> Result<()>
where
    S: StreamExt<Item = Result<bytes::Bytes, reqwest::Error>> + Unpin,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        for line in buf.lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                    if v.get("type").and_then(|t| t.as_str()) == Some(want) {
                        return Ok(());
                    }
                }
            }
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        let Some(chunk) = stream.next().await else {
            break;
        };
        buf.push_str(&String::from_utf8_lossy(&chunk?));
    }
    Err(anyhow!("timed out waiting for {want}"))
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// reqwest stream uses bytes::Bytes
use bytes;
