import { randomUUID } from "node:crypto";
import { notifyWallets } from "@/server/hub";
import { creditPool, creditWallet, pushHistory } from "@/server/ledger-store";

export const runtime = "nodejs";

const PACKS: Record<string, { usd: number; credits: number }> = {
  "5": { usd: 5, credits: 500 },
  "20": { usd: 20, credits: 2200 },
  "50": { usd: 50, credits: 6000 },
};

/** Demo Lightning / test-mode confirm. Real Lightning should hit a webhook. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    deviceId?: string;
    code?: string;
    pack?: string;
    target?: "wallet" | "pool";
  };
  const pack = PACKS[body.pack || "5"];
  const deviceId = body.deviceId;
  const code = (body.code || "HIVE").toUpperCase();
  if (!deviceId || !pack) return Response.json({ error: "bad request" }, { status: 400 });
  if (body.target === "pool") creditPool(code, pack.credits);
  else creditWallet(deviceId, pack.credits);
  pushHistory(deviceId, {
    id: randomUUID(),
    at: Date.now(),
    credits: pack.credits,
    usd: pack.usd,
    rail: "lightning",
    note: "Lightning test invoice settled",
  });
  notifyWallets(code, [deviceId]);
  return Response.json({ ok: true, credits: pack.credits });
}
