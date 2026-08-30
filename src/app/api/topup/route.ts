import { randomUUID } from "node:crypto";
import { notifyWallets } from "@/server/hub";
import {
  creditPool,
  creditWallet,
  isLightningConfigured,
  isStripeConfigured,
  pushHistory,
} from "@/server/ledger-store";

export const runtime = "nodejs";

const PACKS: Record<string, { usd: number; credits: number }> = {
  "5": { usd: 5, credits: 500 },
  "20": { usd: 20, credits: 2200 },
  "50": { usd: 50, credits: 6000 },
};

export async function POST(req: Request) {
  const body = (await req.json()) as {
    deviceId?: string;
    code?: string;
    pack?: string;
    rail?: "demo" | "stripe" | "lightning" | "pool";
    target?: "wallet" | "pool";
  };
  const deviceId = body.deviceId;
  const code = (body.code || "HIVE").toUpperCase();
  const pack = PACKS[body.pack || "5"];
  if (!deviceId || !pack) {
    return Response.json({ error: "deviceId and pack required" }, { status: 400 });
  }

  const rail = body.rail || (isStripeConfigured() ? "stripe" : "demo");
  const target = body.target || "wallet";

  if (rail === "demo" || !isStripeConfigured() && rail === "stripe") {
    if (target === "pool") creditPool(code, pack.credits);
    else creditWallet(deviceId, pack.credits);
    pushHistory(deviceId, {
      id: randomUUID(),
      at: Date.now(),
      credits: pack.credits,
      usd: pack.usd,
      rail: target === "pool" ? "pool" : "demo",
      note: target === "pool" ? `Office pool +${pack.credits}` : `Demo top-up +${pack.credits}`,
    });
    notifyWallets(code, [deviceId]);
    return Response.json({
      ok: true,
      rail: "demo",
      credits: pack.credits,
      testMode: true,
    });
  }

  if (rail === "lightning") {
    if (!isLightningConfigured()) {
      // Test invoice: credit after the client confirms (demo webln / mark-paid).
      return Response.json({
        ok: true,
        rail: "lightning",
        testMode: true,
        invoice: `lntb${pack.usd * 1000}n1ptest${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        credits: pack.credits,
        pack: body.pack,
      });
    }
    const invoice = await createLnbitsInvoice(pack.usd, pack.credits, deviceId, code, target);
    return Response.json(invoice);
  }

  if (rail === "stripe" && isStripeConfigured()) {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const intent = await stripe.paymentIntents.create({
      amount: pack.usd * 100,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        deviceId,
        code,
        credits: String(pack.credits),
        target,
      },
    });
    return Response.json({
      ok: true,
      rail: "stripe",
      clientSecret: intent.client_secret,
      credits: pack.credits,
      usd: pack.usd,
    });
  }

  return Response.json({ error: "Unsupported rail" }, { status: 400 });
}

async function createLnbitsInvoice(
  usd: number,
  credits: number,
  deviceId: string,
  code: string,
  target: string,
) {
  const sats = Math.max(10, Math.round(usd * 100)); // demo fx: $1 ≈ 100 sats in test
  const res = await fetch(`${process.env.LNBITS_URL}/api/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.LNBITS_ADMIN_KEY as string,
    },
    body: JSON.stringify({
      out: false,
      amount: sats,
      memo: `Hive ${credits} credits`,
      extra: { deviceId, code, credits, target },
    }),
  });
  if (!res.ok) throw new Error("LNbits invoice failed");
  const data = (await res.json()) as { payment_request: string; payment_hash: string };
  return {
    ok: true,
    rail: "lightning",
    testMode: false,
    invoice: data.payment_request,
    hash: data.payment_hash,
    credits,
  };
}
