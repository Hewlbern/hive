use crate::client::HiveClient;
use hive_core::PairingStore;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// Shared runtime state for slash commands.
pub struct BotState {
    pub hive: HiveClient,
    pub pairing: Mutex<PairingStore>,
    /// guild_id → device_ids currently marked sharing (optimistic local view)
    pub sharing: Mutex<HashMap<String, HashMap<String, u64>>>,
    pub config_dir: PathBuf,
}

impl BotState {
    pub fn new(hive_base: impl Into<String>, config_dir: PathBuf) -> anyhow::Result<Arc<Self>> {
        let pairing_path = config_dir.join("pairing.json");
        let pairing = PairingStore::open(&pairing_path).unwrap_or_else(|_| PairingStore::in_memory());
        Ok(Arc::new(Self {
            hive: HiveClient::new(hive_base),
            pairing: Mutex::new(pairing),
            sharing: Mutex::new(HashMap::new()),
            config_dir,
        }))
    }

    pub fn for_tests(hive_base: impl Into<String>) -> Arc<Self> {
        Arc::new(Self {
            hive: HiveClient::new(hive_base),
            pairing: Mutex::new(PairingStore::in_memory()),
            sharing: Mutex::new(HashMap::new()),
            config_dir: PathBuf::from("/tmp/hive-test"),
        })
    }

    pub fn set_sharing(&self, guild_id: &str, device_id: &str, vram_mb: u64) {
        self.sharing
            .lock()
            .entry(guild_id.to_string())
            .or_default()
            .insert(device_id.to_string(), vram_mb);
    }

    pub fn clear_sharing(&self, guild_id: &str, device_id: &str) {
        if let Some(m) = self.sharing.lock().get_mut(guild_id) {
            m.remove(device_id);
        }
    }

    pub fn vram_list(&self, guild_id: &str) -> Vec<u64> {
        self.sharing
            .lock()
            .get(guild_id)
            .map(|m| m.values().copied().collect())
            .unwrap_or_default()
    }
}
