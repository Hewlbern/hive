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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0c0c10]/70 p-3 sm:items-center">
      <button className="absolute inset-0" aria-label="Close wallet" onClick={onClose} />
      <div className="sheet-lg glow-violet relative z-10 w-full max-w-md bg-bg-panel p-6 sm:p-8" data-testid="wallet-sheet">
        <p className="label">Wallet</p>
        <p className="mt-2 text-6xl font-semibold tracking-tight" data-testid="wallet-balance">
          {formatCredits(wallet?.balance ?? 0)}
        </p>
        <p className="mt-1 text-sm text-muted">
          {wallet?.testMode ? "TEST credits" : "Credits"} · 1 credit = 1 token
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Stat label="Earned" value={formatCredits(wallet?.sessionEarned ?? 0)} />
          <Stat label="Office pool" value={formatCredits(wallet?.poolBalance ?? 0)} />
        </div>

        <div className="mt-6 flex gap-2">
          <button
            className={`rounded-full px-4 py-2 text-sm font-semibold ${target === "wallet" ? "bg-violet text-white" : "bg-bg text-muted"}`}
            onClick={() => setTarget("wallet")}
          >
            My wallet
          </button>
          <button
            className={`rounded-full px-4 py-2 text-sm font-semibold ${target === "pool" ? "bg-violet text-white" : "bg-bg text-muted"}`}
            onClick={() => setTarget("pool")}
          >
            Office pool
          </button>
        </div>

        <p className="mt-6 text-sm text-muted">Add credits. They land instantly on the demo rail.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {PACKS.map((p) => (
            <button
              key={p.id}
              data-testid={`topup-${p.id}`}
              disabled={busy !== null}
              onClick={() => pay(p.id, "demo")}
              className="rounded-[22px] bg-bg py-4 text-center disabled:opacity-40"
            >
              <span className="block text-xl font-semibold">${p.usd}</span>
              <span className="mt-1 block text-xs text-muted">{p.credits} cr</span>
            </button>
          ))}
        </div>
        <Button
          className="mt-3 w-full"
          variant="line"
          disabled={busy !== null}
          onClick={() => pay("5", "lightning")}
        >
          Lightning · $5
        </Button>

        {invoice ? (
          <div className="mt-4 rounded-[22px] bg-bg p-4">
            <p className="text-xs text-muted">Test invoice. Mark paid to credit the ledger.</p>
            <p className="mt-2 break-all font-mono text-[10px] text-violet-soft">{invoice.bolt11}</p>
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
          <p className="label">Recent</p>
          <ul className="mt-2 max-h-32 space-y-2 overflow-auto text-sm">
            {history.length === 0 ? (
              <li className="text-muted">Starter credits are already on this device.</li>
            ) : (
              history.map((h) => (
                <li key={h.id} className="flex justify-between text-muted">
                  <span>{h.note}</span>
                  <span className="text-violet-soft">+{h.credits}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <Button variant="ghost" className="mt-4 w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] bg-bg p-4">
      <p className="label">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
