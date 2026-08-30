//! Functional: two devices share into a fake guild; /ask fans tokens (mock Discord HTTP via Hive hub).

use hive_core::{catalog_status, guild_to_swarm_id, PairingStore};
use hive_discord::BotState;
use serde_json::json;
use std::sync::Arc;

/// Pure functional path without a live Next server: pairing + pool unlock for a guild.
#[tokio::test]
async fn two_devices_unlock_then_status() {
    let guild = "987654321098765432";
    let swarm = guild_to_swarm_id(guild).unwrap();
    assert_eq!(swarm, format!("dc:{guild}"));

    let state = BotState::for_tests("http://127.0.0.1:9");
    let mut store = PairingStore::in_memory();
    store.register("AAA111", "laptop-a").unwrap();
    store.register("BBB222", "phone-b").unwrap();
    let a = store.consume("AAA111", "user-a", guild).unwrap();
    let b = store.consume("BBB222", "user-b", guild).unwrap();
    state.set_sharing(guild, &a.device_id, 320);
    state.set_sharing(guild, &b.device_id, 900);

    let status = catalog_status(&state.vram_list(guild));
    assert_eq!(status.sharing, 2);
    assert!(status.pooled_mb >= 1200);
    assert!(status.unlocked.contains(&"hive-nano"));
    assert!(status.unlocked.contains(&"hive-15"));

    state.clear_sharing(guild, &a.device_id);
    state.clear_sharing(guild, &b.device_id);
    let locked = catalog_status(&state.vram_list(guild));
    assert_eq!(locked.sharing, 0);
    assert!(locked.unlocked.is_empty());
}

#[tokio::test]
async fn pairing_consume_once_across_store() {
    let mut store = PairingStore::in_memory();
    store.register("PAIR01", "dev-9").unwrap();
    assert!(store.consume("PAIR01", "u1", "g1").is_ok());
    assert!(store.consume("PAIR01", "u2", "g1").is_err());
}

/// When a wiremock Hive hub is up, ask() joins and can receive a synthetic token fan-out.
#[tokio::test]
async fn ask_collects_tokens_from_mock_hub() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    // SSE: ready, then after a beat a token event (simplified — client waits for ready then posts)
    Mock::given(method("GET"))
        .and(path("/api/signal"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    "data: {\"type\":\"ready\"}\n\n\
                     data: {\"type\":\"token\",\"event\":{\"generationId\":\"g\",\"index\":0,\"token\":\"Hello\",\"done\":false,\"tokPerSec\":1}}\n\n\
                     data: {\"type\":\"token\",\"event\":{\"generationId\":\"g\",\"index\":1,\"token\":\" world\",\"done\":true,\"tokPerSec\":1}}\n\n",
                ),
        )
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/signal"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
        .mount(&server)
        .await;

    let client = hive_discord::HiveClient::new(server.uri());
    let swarm = guild_to_swarm_id("111").unwrap();
    let (_gid, tokens) = client.ask(&swarm, "hi", 8).await.expect("ask");
    assert!(tokens.join("").contains("Hello"));
}

#[tokio::test]
async fn bot_state_share_unshare_presence() {
    let state: Arc<BotState> = BotState::for_tests("http://example.invalid");
    state.set_sharing("g", "d1", 400);
    state.set_sharing("g", "d2", 400);
    assert_eq!(state.vram_list("g").len(), 2);
    state.clear_sharing("g", "d1");
    assert_eq!(state.vram_list("g").len(), 1);
}
