use crate::app_state::AppState;
use hive_core::PairingStore;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use std::sync::Arc;

#[derive(Serialize)]
pub struct StatusDto {
    pub device_id: String,
    pub sharing: bool,
    pub pooled_mb: u64,
    pub session_earned: f64,
    pub pairing_code: Option<String>,
    pub hive_url: String,
    pub discord_token_set: bool,
}

#[tauri::command]
pub fn get_status(state: State<'_, Arc<AppState>>) -> StatusDto {
    let s = state.inner.lock();
    StatusDto {
        device_id: s.device_id.clone(),
        sharing: s.sharing,
        pooled_mb: s.pooled_mb,
        session_earned: s.session_earned,
        pairing_code: s.pairing_code.clone(),
        hive_url: s.hive_url.clone(),
        discord_token_set: s.discord_token_set,
    }
}

#[tauri::command]
pub fn set_sharing(state: State<'_, Arc<AppState>>, sharing: bool) -> StatusDto {
    {
        let mut s = state.inner.lock();
        s.sharing = sharing;
        if sharing && s.pooled_mb == 0 {
            s.pooled_mb = 320; // optimistic until web probe heartbeats
        }
        if !sharing {
            s.pooled_mb = 0;
        }
    }
    get_status(state)
}

#[tauri::command]
pub async fn pairing_code(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let (device_id, hive_url, config_dir) = {
        let s = state.inner.lock();
        (s.device_id.clone(), s.hive_url.clone(), state.config_dir.clone())
    };
    let mut store = PairingStore::open(config_dir.join("pairing.json"))
        .map_err(|e| e.to_string())?;
    let code = store
        .generate_code(&device_id)
        .map_err(|e| e.to_string())?;

    // Also register on the hub so a standalone bot can consume it.
    let client = reqwest::Client::new();
    let url = format!("{}/api/pairing/register", hive_url.trim_end_matches('/'));
    let _ = client
        .post(url)
        .json(&serde_json::json!({ "code": code, "deviceId": device_id }))
        .send()
        .await;

    state.inner.lock().pairing_code = Some(code.clone());
    Ok(code)
}

#[derive(Serialize)]
pub struct ConfigDto {
    pub hive_url: String,
    pub discord_token_set: bool,
    pub config_dir: String,
}

#[tauri::command]
pub fn get_config(state: State<'_, Arc<AppState>>) -> ConfigDto {
    ConfigDto {
        hive_url: state.hive_url.clone(),
        discord_token_set: state.inner.lock().discord_token_set,
        config_dir: state.config_dir.display().to_string(),
    }
}

#[tauri::command]
pub fn set_discord_token(state: State<'_, Arc<AppState>>, token: String) -> Result<(), String> {
    let path = state.config_dir.join("discord_bot_token");
    if token.trim().is_empty() {
        let _ = std::fs::remove_file(path);
        state.inner.lock().discord_token_set = false;
        return Ok(());
    }
    std::fs::write(path, token.trim()).map_err(|e| e.to_string())?;
    state.inner.lock().discord_token_set = true;
    Ok(())
}

#[tauri::command]
pub fn open_hive(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = state.hive_url.as_str();
    Ok(())
}
