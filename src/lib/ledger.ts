import type { LayerAssignment } from "./protocol";
import { CREDIT_PER_TOKEN } from "./protocol";

export type Split = { deviceId: string; credits: number };

export type ReserveResult =
  | { ok: true; reserved: number; source: "wallet" | "pool"; walletAfter: number; poolAfter: number }
  | { ok: false; reason: "insufficient"; needed: number; wallet: number; pool: number };

/**
 * 1 generated token = CREDIT_PER_TOKEN credits.
 * Workers are paid in proportion to layers held. Remainder goes to the
 * worker that held the most layers (usually the strongest device).
 */
export function splitTokenCredits(
  assignments: LayerAssignment[],
  nLayers: number,
  credits: number = CREDIT_PER_TOKEN,
): Split[] {
  if (credits <= 0 || nLayers <= 0 || assignments.length === 0) return [];
  const active = assignments.filter((a) => a.end > a.start);
  if (active.length === 0) return [];

  const weights = active.map((a) => a.end - a.start);
  const totalLayers = weights.reduce((s, w) => s + w, 0);
  if (totalLayers <= 0) return [];

  // Work in milli-credits so small integer credits still split fairly.
  const milli = Math.round(credits * 1000);
  const raw = weights.map((w) => (milli * w) / totalLayers);
  const floors = raw.map((r) => Math.floor(r));
  let left = milli - floors.reduce((s, n) => s + n, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), layers: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.layers - a.layers);
  for (let k = 0; k < left; k++) {
    floors[order[k % order.length].i] += 1;
  }

  return active
    .map((a, i) => ({ deviceId: a.deviceId, credits: floors[i] / 1000 }))
    .filter((s) => s.credits > 0);
}

export function reserveForPrompt(
  wallet: number,
  pool: number,
  maxTokens: number,
  allowPool: boolean,
): ReserveResult {
  const needed = maxTokens * CREDIT_PER_TOKEN;
  if (wallet >= needed) {
    return {
      ok: true,
      reserved: needed,
      source: "wallet",
      walletAfter: wallet - needed,
      poolAfter: pool,
    };
  }
  if (allowPool && wallet + pool >= needed) {
    const fromWallet = wallet;
    const fromPool = needed - fromWallet;
    return {
      ok: true,
      reserved: needed,
      source: "pool",
      walletAfter: 0,
      poolAfter: pool - fromPool,
    };
  }
  return { ok: false, reason: "insufficient", needed, wallet, pool };
}

export function releaseUnused(reserved: number, tokensEmitted: number): number {
  const used = tokensEmitted * CREDIT_PER_TOKEN;
  return Math.max(0, reserved - used);
}

export function applyTokenSettlement(args: {
  reservedLeft: number;
  assignments: LayerAssignment[];
  nLayers: number;
  requesterId: string;
  balances: Record<string, number>;
  poolBalance: number;
  source: "wallet" | "pool";
}): {
  reservedLeft: number;
  splits: Split[];
  requesterDebit: number;
  balances: Record<string, number>;
  poolBalance: number;
} {
  const debit = Math.min(CREDIT_PER_TOKEN, args.reservedLeft);
  const splits = splitTokenCredits(args.assignments, args.nLayers, debit);
  const balances = { ...args.balances };
  let poolBalance = args.poolBalance;

  // Reserve already removed funds from wallet or pool. Paying workers
  // credits those balances; the requester is not debited again.
  for (const s of splits) {
    balances[s.deviceId] = (balances[s.deviceId] ?? 0) + s.credits;
  }

  return {
    reservedLeft: args.reservedLeft - debit,
    splits,
    requesterDebit: debit,
    balances,
    poolBalance,
  };
}
