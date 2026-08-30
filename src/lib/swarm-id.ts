/**
 * Normalize a building / Discord-guild swarm code for the hub.
 *
 * Office codes: short A–Z0–9 (e.g. HIVE).
 * Discord guilds: `dc:<guild_id>` (kept as lowercase dc: + digits).
 */
export function normalizeSwarmId(raw: string): string {
  const trimmed = (raw || "").trim();
  const discord = trimmed.match(/^dc[:_-]?(\d+)$/i);
  if (discord) return `dc:${discord[1]}`;
  const office = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return office || "HIVE";
}

export function guildToSwarmId(guildId: string): string {
  const digits = String(guildId).replace(/\D/g, "");
  if (!digits) throw new Error("guild id required");
  return `dc:${digits}`;
}

export function isDiscordSwarm(code: string): boolean {
  return normalizeSwarmId(code).startsWith("dc:");
}
