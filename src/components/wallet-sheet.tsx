"use client";

import { formatCredits } from "@/lib/utils";
import type { TopUpRecord, WalletSnapshot } from "@/lib/protocol";
import { useState } from "react";
import { Button } from "./ui/button";

const PACKS = [
  { id: "5" as const, usd: 5, credits: 500 },
  { id: "20" as const, usd: 20, credits: 2200 },
  { id: "50" as const, usd: 50, credits: 6000 },
];

export function WalletSheet({
  open,
  onClose,
  wallet,
  history,
  onTopUp,
  onLightningConfirm,
}: {
  open: boolean;
  onClose: () => void;
  wallet: WalletSnapshot | null;
  history: TopUpRecord[];
  onTopUp: (pack: "5" | "20" | "50", rail: "demo" | "lightning", target: "wallet" | "pool") => Promise<unknown>;
  onLightningConfirm: (pack: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ bolt11: string; pack: string } | null>(null);
  const [target, setTarget] = useState<"wallet" | "pool">("wallet");

  if (!open) return null;

  async function pay(pack: "5" | "20" | "50", rail: "demo" | "lightning") {
    setBusy(`${rail}-${pack}`);
    try {
      const res = (await onTopUp(pack, rail, target)) as { invoice?: string; pack?: string };
      if (res?.invoice) setInvoice({ bolt11: res.invoice, pack });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <button className="absolute inset-0" aria-label="Close wallet" onClick={onClose} />
      <div className="hive-panel relative z-10 w-full max-w-md rounded-3xl p-5 hive-glow">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Wallet</p>
            <p className="mt-1 text-3xl font-semibold">
              ₳{formatCredits(wallet?.balance ?? 0)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {wallet?.testMode ? "TEST credits · demo rail" : "Live rail"} · 1 credit = 1 token
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Earned this session" value={`₳${(wallet?.sessionEarned ?? 0).toFixed(1)}`} />
          <Stat label="Office pool" value={`₳${formatCredits(wallet?.poolBalance ?? 0)}`} />
        </div>

        <div className="mt-5 flex gap-2">
          <button
            className={`rounded-full px-3 py-1 text-xs ${target === "wallet" ? "bg-honey text-[#1a1204]" : "border border-line"}`}
            onClick={() => setTarget("wallet")}
          >
            My wallet
          </button>
          <button
            className={`rounded-full px-3 py-1 text-xs ${target === "pool" ? "bg-honey text-[#1a1204]" : "border border-line"}`}
            onClick={() => setTarget("pool")}
          >
            Office pool
          </button>
        </div>

        <p className="mt-4 text-sm text-muted">One-tap top-up. Credits land in a few seconds.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {PACKS.map((p) => (
            <Button
              key={p.id}
              variant="line"
              disabled={busy !== null}
              onClick={() => pay(p.id, "demo")}
            >
              ${p.usd}
              <span className="block text-[10px] font-mono text-muted">₳{p.credits}</span>
            </Button>
          ))}
        </div>
        <Button
          className="mt-3 w-full"
          variant="line"
          disabled={busy !== null}
          onClick={() => pay("5", "lightning")}
        >
          Lightning invoice · $5
        </Button>

        {invoice ? (
          <div className="mt-4 rounded-2xl border border-line p-3">
            <p className="text-xs text-muted">Test invoice. Mark paid to credit the ledger.</p>
            <p className="mt-2 break-all font-mono text-[10px] text-honey">{invoice.bolt11}</p>
            <Button
              className="mt-3 w-full"
              size="sm"
              onClick={async () => {
                await onLightningConfirm(invoice.pack);
                setInvoice(null);
              }}
            >
              I paid (test)
            </Button>
          </div>
        ) : null}

        <div className="mt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Recent</p>
          <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-sm">
            {history.length === 0 ? (
              <li className="text-muted">No top-ups yet. Starter credits are already in this device wallet.</li>
            ) : (
              history.map((h) => (
                <li key={h.id} className="flex justify-between text-muted">
                  <span>{h.note}</span>
                  <span className="font-mono text-honey">+{h.credits}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
