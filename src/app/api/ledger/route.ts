import { getHistory, getPool, getWallet, isStripeConfigured } from "@/server/ledger-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deviceId = url.searchParams.get("deviceId");
  const code = (url.searchParams.get("code") || "HIVE").toUpperCase();
  if (!deviceId) return Response.json({ error: "deviceId required" }, { status: 400 });
  return Response.json({
    balance: getWallet(deviceId),
    poolBalance: getPool(code),
    history: getHistory(deviceId),
    testMode: !isStripeConfigured(),
  });
}
