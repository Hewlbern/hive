use chrono::{DateTime, Utc};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const TTL_SECS: i64 = 10 * 60;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PairingError {
    #[error("pairing code too short")]
    TooShort,
    #[error("unknown or expired pairing code")]
    UnknownOrExpired,
    #[error("io error: {0}")]
    Io(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingPair {
    pub code: String,
    pub device_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Binding {
    pub discord_user_id: String,
    pub device_id: String,
    pub guild_id: String,
    pub bound_at: DateTime<Utc>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    pending: HashMap<String, PendingPair>,
    bindings: HashMap<String, Binding>,
}

#[derive(Debug)]
pub struct PairingStore {
    path: PathBuf,
    state: State,
}

impl PairingStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, PairingError> {
        let path = path.as_ref().to_path_buf();
        let state = if path.exists() {
            let raw = fs::read_to_string(&path).map_err(|e| PairingError::Io(e.to_string()))?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            State::default()
        };
        Ok(Self { path, state })
    }

    pub fn in_memory() -> Self {
        Self {
            path: PathBuf::from(":memory:"),
            state: State::default(),
        }
    }

    fn persist(&self) -> Result<(), PairingError> {
        if self.path == Path::new(":memory:") {
            return Ok(());
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| PairingError::Io(e.to_string()))?;
        }
        let raw = serde_json::to_string_pretty(&self.state).map_err(|e| PairingError::Io(e.to_string()))?;
        fs::write(&self.path, raw).map_err(|e| PairingError::Io(e.to_string()))
    }

    pub fn generate_code(&mut self, device_id: &str) -> Result<String, PairingError> {
        let code: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .filter(|c| c.is_ascii_alphanumeric())
            .map(|c| (c as char).to_ascii_uppercase())
            .take(6)
            .collect();
        self.register(&code, device_id)?;
        Ok(code)
    }

    pub fn register(&mut self, code: &str, device_id: &str) -> Result<PendingPair, PairingError> {
        let normalized = normalize_code(code)?;
        let entry = PendingPair {
            code: normalized.clone(),
            device_id: device_id.to_string(),
            created_at: Utc::now(),
        };
        self.state.pending.insert(normalized, entry.clone());
        self.persist()?;
        Ok(entry)
    }

    /// Consume-once pairing. Binds discord user ↔ device for a guild.
    pub fn consume(
        &mut self,
        code: &str,
        discord_user_id: &str,
        guild_id: &str,
    ) -> Result<Binding, PairingError> {
        let normalized = normalize_code(code)?;
        let pending = self
            .state
            .pending
            .remove(&normalized)
            .ok_or(PairingError::UnknownOrExpired)?;
        let age = Utc::now()
            .signed_duration_since(pending.created_at)
            .num_seconds();
        if age > TTL_SECS {
            self.persist()?;
            return Err(PairingError::UnknownOrExpired);
        }
        let binding = Binding {
            discord_user_id: discord_user_id.to_string(),
            device_id: pending.device_id,
            guild_id: guild_id.to_string(),
            bound_at: Utc::now(),
        };
        self.state
            .bindings
            .insert(binding_key(guild_id, discord_user_id), binding.clone());
        self.persist()?;
        Ok(binding)
    }

    pub fn get_binding(&self, guild_id: &str, discord_user_id: &str) -> Option<&Binding> {
        self.state.bindings.get(&binding_key(guild_id, discord_user_id))
    }

    pub fn clear_binding(&mut self, guild_id: &str, discord_user_id: &str) -> bool {
        let removed = self
            .state
            .bindings
            .remove(&binding_key(guild_id, discord_user_id))
            .is_some();
        if removed {
            let _ = self.persist();
        }
        removed
    }

    pub fn devices_for_guild(&self, guild_id: &str) -> Vec<&Binding> {
        self.state
            .bindings
            .values()
            .filter(|b| b.guild_id == guild_id)
            .collect()
    }
}

fn binding_key(guild_id: &str, discord_user_id: &str) -> String {
    format!("{guild_id}:{discord_user_id}")
}

fn normalize_code(code: &str) -> Result<String, PairingError> {
    let n: String = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .take(6)
        .collect();
    if n.len() < 4 {
        Err(PairingError::TooShort)
    } else {
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consume_once() {
        let mut store = PairingStore::in_memory();
        store.register("ab12cd", "device-1").unwrap();
        let first = store.consume("AB12CD", "user-9", "guild-1").unwrap();
        assert_eq!(first.device_id, "device-1");
        assert!(store.get_binding("guild-1", "user-9").is_some());
        assert_eq!(
            store.consume("AB12CD", "user-9", "guild-1"),
            Err(PairingError::UnknownOrExpired)
        );
    }

    #[test]
    fn unshare_clears_binding() {
        let mut store = PairingStore::in_memory();
        store.register("ZZZZZZ", "dev").unwrap();
        store.consume("ZZZZZZ", "u", "g").unwrap();
        assert!(store.clear_binding("g", "u"));
        assert!(store.get_binding("g", "u").is_none());
    }
}
