use crate::{BotState, Context, Error};
use hive_core::{catalog_status, guild_to_swarm_id, MODEL_CATALOG};
use poise::CreateReply;
use std::sync::Arc;

/// Server status: sharers, pooled VRAM, unlocked models.
#[poise::command(slash_command, description_localized("en-US", "Hive swarm status for this Discord server"))]
pub async fn hive(ctx: Context<'_>) -> Result<(), Error> {
    let guild_id = ctx
        .guild_id()
        .ok_or("Use /hive inside a Discord server")?;
    let swarm = guild_to_swarm_id(&guild_id.to_string())?;
    let state: &Arc<BotState> = ctx.data();

    let building = state.hive.get_building(&swarm).await.ok();
    let local = state.vram_list(&guild_id.to_string());
    let status = if let Some(ref b) = building {
        let vrams: Vec<u64> = b
            .members
            .iter()
            .filter(|m| m.sharing)
            .map(|m| m.vram_mb)
            .collect();
        catalog_status(&vrams)
    } else {
        catalog_status(&local)
    };

    let unlocked = if status.unlocked.is_empty() {
        "_(none — catalog locked)_".into()
    } else {
        status
            .unlocked
            .iter()
            .filter_map(|id| MODEL_CATALOG.iter().find(|m| m.id == *id).map(|m| m.name))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let next = match (status.locked_next, status.next_hint) {
        (Some(id), Some(hint)) => {
            let name = MODEL_CATALOG
                .iter()
                .find(|m| m.id == id)
                .map(|m| m.name)
                .unwrap_or(id);
            format!("**Next:** {name} — {hint}")
        }
        _ => "**Next:** catalog fully unlocked on paper.".into(),
    };

    let body = format!(
        "**Hive · `{swarm}`**\n\
         Sharing: **{}** device(s) · Pooled: **{} MB** ({:.2} GB)\n\
         Unlocked: {unlocked}\n\
         {next}",
        status.sharing,
        status.pooled_mb,
        status.pooled_mb as f64 / 1024.0,
    );

    ctx.send(CreateReply::default().content(body).ephemeral(false))
        .await?;
    Ok(())
}

/// Pair this Discord user to the desktop app and mark share-compute ON.
#[poise::command(slash_command, description_localized("en-US", "Share this machine's compute into the server swarm"))]
pub async fn share(
    ctx: Context<'_>,
    #[description = "6-character pairing code from the Hive desktop app"] code: Option<String>,
) -> Result<(), Error> {
    let guild_id = ctx
        .guild_id()
        .ok_or("Use /share inside a Discord server")?;
    let user_id = ctx.author().id.to_string();
    let guild = guild_id.to_string();
    let swarm = guild_to_swarm_id(&guild)?;
    let state: &Arc<BotState> = ctx.data();

    let Some(code) = code else {
        ctx.send(
            CreateReply::default()
                .content(
                    "Open the **Hive** desktop app → copy the 6-character pairing code → \
                     run `/share code:XXXXXX`.\n\
                     That links your Discord user to the machine and turns **Share compute** on \
                     for this server (`{swarm}`).",
                )
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    };

    // Prefer hub consume (works across bot host + desktop); fall back to local store.
    let binding = match state
        .hive
        .consume_pairing(&code, &user_id, &guild)
        .await
    {
        Ok(b) => {
            let mut store = state.pairing.lock();
            let _ = store.register(&code, &b.device_id); // no-op if already consumed remotely
            drop(store);
            b.device_id
        }
        Err(_) => {
            let mut store = state.pairing.lock();
            let b = store.consume(&code, &user_id, &guild)?;
            b.device_id
        }
    };

    // Default phone-class VRAM until the desktop heartbeats a real probe.
    state.set_sharing(&guild, &binding, 900);

    ctx.send(
        CreateReply::default()
            .content(format!(
                "Linked device `{binding}` and marked **Share compute ON** for `{swarm}`.\n\
                 Keep the Hive desktop app open. Run `/hive` to see the pool grow."
            ))
            .ephemeral(true),
    )
    .await?;
    Ok(())
}

/// Stop contributing this machine.
#[poise::command(slash_command, description_localized("en-US", "Stop sharing compute from your paired machine"))]
pub async fn unshare(ctx: Context<'_>) -> Result<(), Error> {
    let guild_id = ctx
        .guild_id()
        .ok_or("Use /unshare inside a Discord server")?;
    let user_id = ctx.author().id.to_string();
    let guild = guild_id.to_string();
    let state: &Arc<BotState> = ctx.data();

    let device_id = {
        let store = state.pairing.lock();
        store
            .get_binding(&guild, &user_id)
            .map(|b| b.device_id.clone())
    };

    let Some(device_id) = device_id else {
        ctx.send(
            CreateReply::default()
                .content("You're not paired in this server. Use `/share` with a pairing code first.")
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    };

    state.clear_sharing(&guild, &device_id);
    state.pairing.lock().clear_binding(&guild, &user_id);
    let _ = state.hive.clear_binding(&guild, &user_id).await;

    ctx.send(
        CreateReply::default()
            .content(format!(
                "Share compute **OFF** for device `{device_id}`. Run `/hive` to see the catalog lock."
            ))
            .ephemeral(true),
    )
    .await?;
    Ok(())
}

/// Run a prompt on the guild swarm.
#[poise::command(slash_command, description_localized("en-US", "Ask the Hive swarm in this server"))]
pub async fn ask(
    ctx: Context<'_>,
    #[description = "What should the swarm generate?"] prompt: String,
) -> Result<(), Error> {
    let guild_id = ctx
        .guild_id()
        .ok_or("Use /ask inside a Discord server")?;
    let swarm = guild_to_swarm_id(&guild_id.to_string())?;
    let state: &Arc<BotState> = ctx.data();

    let building = state.hive.get_building(&swarm).await.ok();
    let vrams: Vec<u64> = if let Some(ref b) = building {
        b.members
            .iter()
            .filter(|m| m.sharing)
            .map(|m| m.vram_mb)
            .collect()
    } else {
        state.vram_list(&guild_id.to_string())
    };
    let status = catalog_status(&vrams);
    if status.unlocked.is_empty() {
        ctx.send(
            CreateReply::default()
                .content(format!(
                    "Catalog is locked for `{swarm}`. Nobody is sharing compute yet.\n\
                     Open the Hive app, copy a pairing code, run `/share`, and invite a second machine if you can."
                ))
                .ephemeral(false),
        )
        .await?;
        return Ok(());
    }

    ctx.defer().await?;
    match state.hive.ask(&swarm, &prompt, 48).await {
        Ok((_gid, tokens)) => {
            let text = tokens.concat();
            let reply = if text.trim().is_empty() {
                "_(empty completion)_".into()
            } else if text.len() > 1800 {
                format!("{}…", &text[..1800])
            } else {
                text
            };
            ctx.say(format!("**Swarm · {swarm}**\n{reply}")).await?;
        }
        Err(err) => {
            ctx.say(format!(
                "Couldn't run that on `{swarm}`: {err}\n\
                 Tip: keep the desktop app open with **Share compute** on, and prefer Hive Nano while testing."
            ))
            .await?;
        }
    }
    Ok(())
}
