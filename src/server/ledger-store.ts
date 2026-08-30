import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEMO_STARTER_CREDITS,
  HIVE_POOL_STARTER,
  type TopUpRecord,
} from "@/lib/protocol";

export type PersistedState = {
  wallets: Record<string, number>;
  pools: Record<string, number>;
  history: Record<string, TopUpRecord[]>;
};

const DATA_PATH = process.env.HIVE_LEDGER_PATH || join(process.cwd(), "data", "ledger.json");

function empty(): PersistedState {
  return {
    wallets: {},
    pools: { HIVE: HIVE_POOL_STARTER },
    history: {},
  };
}

function load(): PersistedState {
  try {
    const raw = readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed.pools.HIVE) parsed.pools.HIVE = HIVE_POOL_STARTER;
    return parsed;
  } catch {
    return empty();
  }
}

let state = load();

function persist() {
  try {
    mkdirSync(dirname(DATA_PATH), { recursive: true });
    writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn("[hive] ledger persist failed", err);
  }
}

export function getWallet(deviceId: string): number {
  if (state.wallets[deviceId] === undefined) {
    state.wallets[deviceId] = DEMO_STARTER_CREDITS;
    persist();
  }
  return state.wallets[deviceId];
}

export function setWallet(deviceId: string, amount: number) {
  state.wallets[deviceId] = Math.max(0, amount);
  persist();
}

export function creditWallet(deviceId: string, amount: number) {
  setWallet(deviceId, getWallet(deviceId) + amount);
}

export function getPool(code: string): number {
  const key = code.toUpperCase();
  if (state.pools[key] === undefined) {
    state.pools[key] = key === "HIVE" ? HIVE_POOL_STARTER : 0;
    persist();
  }
  return state.pools[key];
}

export function setPool(code: string, amount: number) {
  state.pools[code.toUpperCase()] = Math.max(0, amount);
  persist();
}

export function creditPool(code: string, amount: number) {
  setPool(code, getPool(code) + amount);
}

export function pushHistory(deviceId: string, record: TopUpRecord) {
  const list = state.history[deviceId] ?? [];
  list.unshift(record);
  state.history[deviceId] = list.slice(0, 40);
  persist();
}

export function getHistory(deviceId: string): TopUpRecord[] {
  return state.history[deviceId] ?? [];
}

export function snapshotBalances(): Record<string, number> {
  return { ...state.wallets };
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

export function isLightningConfigured(): boolean {
  return Boolean(process.env.LNBITS_URL && process.env.LNBITS_ADMIN_KEY);
}

export function resetLedgerForTests() {
  state = empty();
}
