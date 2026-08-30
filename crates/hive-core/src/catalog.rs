//! Mirror of the web catalog unlock rules (pooled VRAM for pipeline models).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelDef {
    pub id: &'static str,
    pub name: &'static str,
    pub params: &'static str,
    pub vram_mb: u64,
    pub live: bool,
    pub split: SplitKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SplitKind {
    Pipeline,
    Single,
}

pub static MODEL_CATALOG: &[ModelDef] = &[
    ModelDef {
        id: "hive-nano",
        name: "Hive Nano",
        params: "260K",
        vram_mb: 8,
        live: true,
        split: SplitKind::Pipeline,
    },
    ModelDef {
        id: "hive-15",
        name: "Hive 15",
        params: "15M",
        vram_mb: 80,
        live: true,
        split: SplitKind::Pipeline,
    },
    ModelDef {
        id: "qwen25-05",
        name: "Qwen 2.5 0.5B",
        params: "0.5B",
        vram_mb: 950,
        live: true,
        split: SplitKind::Single,
    },
    ModelDef {
        id: "qwen25-7",
        name: "Qwen 2.5 7B",
        params: "7B",
        vram_mb: 5100,
        live: true,
        split: SplitKind::Single,
    },
    ModelDef {
        id: "qwen25-14",
        name: "Qwen 2.5 14B",
        params: "14B",
        vram_mb: 9200,
        live: false,
        split: SplitKind::Pipeline,
    },
    ModelDef {
        id: "qwen3-27",
        name: "Qwen 3 27B",
        params: "27B",
        vram_mb: 18000,
        live: false,
        split: SplitKind::Pipeline,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogStatus {
    pub sharing: usize,
    pub pooled_mb: u64,
    pub unlocked: Vec<&'static str>,
    pub locked_next: Option<&'static str>,
    pub next_hint: Option<String>,
}

pub fn pooled_mb(vram_per_sharer: &[u64]) -> u64 {
    vram_per_sharer.iter().sum()
}

pub fn sharing_count(vram_per_sharer: &[u64]) -> usize {
    vram_per_sharer.iter().filter(|&&v| v > 0).count()
}

pub fn model_fits(model: &ModelDef, vram_per_sharer: &[u64]) -> bool {
    let sharers: Vec<u64> = vram_per_sharer.iter().copied().filter(|&v| v > 0).collect();
    if sharers.is_empty() {
        return false;
    }
    match model.split {
        SplitKind::Single => sharers.iter().any(|&v| v >= model.vram_mb),
        SplitKind::Pipeline => pooled_mb(&sharers) >= model.vram_mb,
    }
}

pub fn next_unlock_hint(model: &ModelDef, vram_per_sharer: &[u64]) -> Option<String> {
    if model_fits(model, vram_per_sharer) {
        return None;
    }
    let sharers: Vec<u64> = vram_per_sharer.iter().copied().filter(|&v| v > 0).collect();
    if sharers.is_empty() {
        return Some("Someone has to /share (or tap Share compute in the app)".into());
    }
    let pool = pooled_mb(&sharers);
    let need = model.vram_mb.saturating_sub(pool);
    if need == 0 {
        return Some("Needs a single device with enough VRAM (WebGPU laptop)".into());
    }
    let phones = need.div_ceil(1500).max(1);
    Some(format!(
        "~{need} MB more — about {phones} more phone{}",
        if phones == 1 { "" } else { "s" }
    ))
}

pub fn catalog_status(vram_per_sharer: &[u64]) -> CatalogStatus {
    let unlocked: Vec<&'static str> = MODEL_CATALOG
        .iter()
        .filter(|m| model_fits(m, vram_per_sharer))
        .map(|m| m.id)
        .collect();
    let locked_next = MODEL_CATALOG
        .iter()
        .find(|m| !model_fits(m, vram_per_sharer))
        .map(|m| m.id);
    let next_hint = locked_next.and_then(|id| {
        MODEL_CATALOG
            .iter()
            .find(|m| m.id == id)
            .and_then(|m| next_unlock_hint(m, vram_per_sharer))
    });
    CatalogStatus {
        sharing: sharing_count(vram_per_sharer),
        pooled_mb: pooled_mb(vram_per_sharer),
        unlocked,
        locked_next,
        next_hint,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_until_someone_shares() {
        let s = catalog_status(&[]);
        assert_eq!(s.sharing, 0);
        assert!(s.unlocked.is_empty());
        assert_eq!(s.locked_next, Some("hive-nano"));
    }

    #[test]
    fn phone_unlocks_nano() {
        let s = catalog_status(&[900]);
        assert!(s.unlocked.contains(&"hive-nano"));
        assert!(s.unlocked.contains(&"hive-15"));
        assert!(!s.unlocked.contains(&"qwen25-7"));
    }

    #[test]
    fn two_devices_pool_toward_larger_models() {
        let one = catalog_status(&[400]);
        let two = catalog_status(&[400, 400]);
        assert!(two.pooled_mb > one.pooled_mb);
        assert!(two.unlocked.len() >= one.unlocked.len());
    }
}
