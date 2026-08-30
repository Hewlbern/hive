import { randomUUID } from "node:crypto";
import { notifyWallets } from "@/server/hub";
import { creditPool, creditWallet, pushHistory } from "@/server/ledger-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const raw = await req.text();
  let event: { type: string; data: { object: Record<string, unknown> } };

  if (secret && process.env.STRIPE_SECRET_KEY) {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers.get("stripe-signature");
    if (!sig) return Response.json({ error: "missing signature" }, { status: 400 });
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret) as unknown as typeof event;
    } catch {
      return Response.json({ error: "bad signature" }, { status: 400 });
    }
  } else {
    event = JSON.parse(raw);
  }

  if (event.type === "payment_intent.succeeded") {
    const obj = event.data.object;
    const meta = (obj.metadata || {}) as Record<string, string>;
    const deviceId = meta.deviceId;
    const code = (meta.code || "HIVE").toUpperCase();
    const credits = Number(meta.credits || 0);
    const target = meta.target === "pool" ? "pool" : "wallet";
    if (deviceId && credits > 0) {
      if (target === "pool") creditPool(code, credits);
      else creditWallet(deviceId, credits);
      pushHistory(deviceId, {
        id: randomUUID(),
        at: Date.now(),
        credits,
        usd: Number(obj.amount || 0) / 100,
        rail: "stripe",
        note: "Stripe payment",
      });
      notifyWallets(code, [deviceId]);
    }
  }

  return Response.json({ received: true });
}
