import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type PendingPair = {
  code: string;
  deviceId: string;
  createdAt: number;
};

export type Binding = {
  discordUserId: string;
  deviceId: string;
  guildId: string;
  boundAt: number;
};

type State = {
  pending: Record<string, PendingPair>;
  bindings: Record<string, Binding>;
};

const DATA_PATH =
  process.env.HIVE_PAIRING_PATH || join(process.cwd(), "data", "pairing.json");

function empty(): State {
  return { pending: {}, bindings: {} };
}

function load(): State {
  try {
    const raw = readFileSync(/* turbopackIgnore: true */ DATA_PATH, "utf8");
    return JSON.parse(raw) as State;
  } catch {
    return empty();
  }
}

let state = load();

function persist() {
  try {
    mkdirSync(/* turbopackIgnore: true */ dirname(DATA_PATH), { recursive: true });
    writeFileSync(/* turbopackIgnore: true */ DATA_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn("[hive] pairing persist failed", err);
  }
}

const TTL_MS = 10 * 60 * 1000;

export function registerPairingCode(code: string, deviceId: string): PendingPair {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (normalized.length < 4) throw new Error("pairing code too short");
  const entry: PendingPair = { code: normalized, deviceId, createdAt: Date.now() };
  state.pending[normalized] = entry;
  persist();
  return entry;
}

/** Consume-once. Returns the binding or null if code is unknown/expired. */
export function consumePairingCode(
  code: string,
  discordUserId: string,
  guildId: string,
): Binding | null {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const pending = state.pending[normalized];
  if (!pending) return null;
  if (Date.now() - pending.createdAt > TTL_MS) {
    delete state.pending[normalized];
    persist();
    return null;
  }
  delete state.pending[normalized];
  const binding: Binding = {
    discordUserId,
    deviceId: pending.deviceId,
    guildId: String(guildId),
    boundAt: Date.now(),
  };
  state.bindings[`${guildId}:${discordUserId}`] = binding;
  persist();
  return binding;
}

export function getBinding(guildId: string, discordUserId: string): Binding | null {
  return state.bindings[`${guildId}:${discordUserId}`] ?? null;
}

export function clearBinding(guildId: string, discordUserId: string): boolean {
  const key = `${guildId}:${discordUserId}`;
  if (!state.bindings[key]) return false;
  delete state.bindings[key];
  persist();
  return true;
}

export function resetPairingForTests() {
  state = empty();
  persist();
}
