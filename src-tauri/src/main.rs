#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod commands;

use app_state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tracing_subscriber::EnvFilter;

fn main() {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("info".parse().unwrap()),
        )
        .init();

    let hive_url =
        std::env::var("HIVE_URL").unwrap_or_else(|_| "http://127.0.0.1:43177".into());
    let state = AppState::new(hive_url.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::set_sharing,
            commands::pairing_code,
            commands::get_config,
            commands::set_discord_token,
            commands::open_hive,
        ])
        .setup(move |app| {
            let url = format!("{}/hive/HIVE", hive_url.trim_end_matches('/'));
            let parsed = url
                .parse()
                .unwrap_or_else(|_| "http://127.0.0.1:43177/hive/HIVE".parse().unwrap());

            // Prefer a single external window onto the live Hive UI.
            if app.get_webview_window("main").is_none() {
                let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                    .title("Hive")
                    .inner_size(1100.0, 800.0)
                    .build();
            }

            let share_i =
                MenuItem::with_id(app, "share_toggle", "Toggle Share compute", true, None::<&str>)?;
            let status_i =
                MenuItem::with_id(app, "status", "Pool / earnings update in the app", false, None::<&str>)?;
            let pair_i =
                MenuItem::with_id(app, "pair", "Copy pairing hint", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open Hive", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&share_i, &status_i, &pair_i, &show_i, &quit_i])?;

            let tray_state = state.clone();
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Hive — share compute")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "share_toggle" => {
                        let mut s = tray_state.inner.lock();
                        s.sharing = !s.sharing;
                        tracing::info!(sharing = s.sharing, pooled_mb = s.pooled_mb, earned = s.session_earned, "tray share");
                    }
                    "pair" => {
                        tracing::info!("Open the app and run the pairing_code command / Settings for a 6-char code");
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            if let Ok(token) = std::env::var("DISCORD_BOT_TOKEN") {
                if !token.trim().is_empty() {
                    let hive = hive_url.clone();
                    let config_dir = state.config_dir.clone();
                    tauri::async_runtime::spawn(async move {
                        match hive_discord::BotState::new(hive, config_dir) {
                            Ok(bot_state) => {
                                if let Err(err) = hive_discord::run_bot(token, bot_state).await {
                                    tracing::error!("Discord bot stopped: {err:#}");
                                }
                            }
                            Err(err) => tracing::error!("Discord bot state: {err:#}"),
                        }
                    });
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Hive desktop failed to start");
}
