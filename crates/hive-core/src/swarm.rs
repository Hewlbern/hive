use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SwarmError {
    #[error("guild id required")]
    EmptyGuild,
}

/// Office codes → short A–Z0–9. Discord guilds → `dc:<guild_id>`.
pub fn normalize_swarm_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(id) = parse_discord(trimmed) {
        return format!("dc:{id}");
    }
    let office: String = trimmed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .take(8)
        .collect();
    if office.is_empty() {
        "HIVE".into()
    } else {
        office
    }
}

pub fn guild_to_swarm_id(guild_id: &str) -> Result<String, SwarmError> {
    let digits: String = guild_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return Err(SwarmError::EmptyGuild);
    }
    Ok(format!("dc:{digits}"))
}

pub fn is_discord_swarm(code: &str) -> bool {
    normalize_swarm_id(code).starts_with("dc:")
}

fn parse_discord(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("dc:") {
        r
    } else if let Some(r) = lower.strip_prefix("dc_") {
        r
    } else if let Some(r) = lower.strip_prefix("dc-") {
        r
    } else {
        return None;
    };
    let digits: String = rest.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_codes() {
        assert_eq!(normalize_swarm_id("hive"), "HIVE");
        assert_eq!(normalize_swarm_id("oaks!!"), "OAKS");
    }

    #[test]
    fn discord_guild_mapping() {
        assert_eq!(
            guild_to_swarm_id("123456789012345678").unwrap(),
            "dc:123456789012345678"
        );
        assert_eq!(normalize_swarm_id("dc:999"), "dc:999");
        assert_eq!(normalize_swarm_id("DC_999"), "dc:999");
        assert!(is_discord_swarm("dc:1"));
        assert!(!is_discord_swarm("HIVE"));
    }
}
