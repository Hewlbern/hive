use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Inner {
    pub device_id: String,
    pub sharing: bool,
    pub pooled_mb: u64,
    pub session_earned: f64,
    pub pairing_code: Option<String>,
    pub discord_token_set: bool,
    pub hive_url: String,
}

pub struct AppState {
    pub inner: Mutex<Inner>,
    pub config_dir: PathBuf,
    pub hive_url: String,
}

impl AppState {
    pub fn new(hive_url: String) -> Arc<Self> {
        let config_dir = default_config_dir();
        let _ = std::fs::create_dir_all(&config_dir);
        let device_path = config_dir.join("device_id");
        let device_id = std::fs::read_to_string(&device_path)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                let id = Uuid::new_v4().to_string();
                let _ = std::fs::write(&device_path, &id);
                id
            });
        let token_set = config_dir.join("discord_bot_token").exists()
            || std::env::var("DISCORD_BOT_TOKEN").ok().filter(|t| !t.is_empty()).is_some();

        Arc::new(Self {
            hive_url: hive_url.clone(),
            config_dir,
            inner: Mutex::new(Inner {
                device_id,
                sharing: false,
                pooled_mb: 0,
                session_earned: 0.0,
                pairing_code: None,
                discord_token_set: token_set,
                hive_url,
            }),
        })
    }
}

fn default_config_dir() -> PathBuf {
    if let Ok(p) = std::env::var("HIVE_CONFIG_DIR") {
        return PathBuf::from(p);
    }
    if let Some(h) = std::env::var_os("HOME") {
        return PathBuf::from(h).join(".config").join("hive");
    }
    PathBuf::from(".hive")
}
