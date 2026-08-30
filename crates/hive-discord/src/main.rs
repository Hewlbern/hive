//! Standalone always-on Discord bot host.
//!
//! ```text
//! DISCORD_BOT_TOKEN=... HIVE_URL=http://127.0.0.1:43177 cargo run -p hive-discord
//! ```

use hive_discord::{run_bot, BotState};
use std::path::PathBuf;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let token = std::env::var("DISCORD_BOT_TOKEN")
        .map_err(|_| anyhow::anyhow!("DISCORD_BOT_TOKEN is required"))?;
    let hive_url =
        std::env::var("HIVE_URL").unwrap_or_else(|_| "http://127.0.0.1:43177".into());
    let config_dir = std::env::var("HIVE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs_next_config()
        });

    std::fs::create_dir_all(&config_dir)?;
    let state = BotState::new(hive_url, config_dir)?;
    run_bot(token, state).await
}

fn dirs_next_config() -> PathBuf {
    if let Some(h) = std::env::var_os("HOME") {
        return PathBuf::from(h).join(".config").join("hive");
    }
    PathBuf::from(".hive")
}
