//! Discord ↔ Hive bridge (slash commands + Hive HTTP client).

pub mod client;
pub mod commands;
pub mod state;

pub use client::HiveClient;
pub use state::BotState;

use poise::serenity_prelude as serenity;
use std::sync::Arc;
use tracing::info;

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Context<'a> = poise::Context<'a, Arc<BotState>, Error>;

/// Run the Discord bot until Ctrl-C. Used by both `hive-discord` and the Tauri host.
pub async fn run_bot(token: String, state: Arc<BotState>) -> anyhow::Result<()> {
    let intents = serenity::GatewayIntents::GUILDS | serenity::GatewayIntents::GUILD_MESSAGES;

    let framework = poise::Framework::builder()
        .options(poise::FrameworkOptions {
            commands: vec![
                commands::hive(),
                commands::share(),
                commands::unshare(),
                commands::ask(),
            ],
            ..Default::default()
        })
        .setup(|ctx, _ready, framework| {
            Box::pin(async move {
                poise::builtins::register_globally(ctx, &framework.options().commands).await?;
                info!("Hive Discord slash commands registered");
                Ok(state.clone())
            })
        })
        .build();

    let mut client = serenity::Client::builder(&token, intents)
        .framework(framework)
        .await
        .map_err(|e| anyhow::anyhow!("build Discord client: {e}"))?;

    info!("Hive Discord bot starting");
    client
        .start()
        .await
        .map_err(|e| anyhow::anyhow!("Discord gateway: {e}"))?;
    Ok(())
}
