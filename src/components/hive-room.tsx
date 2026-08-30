"use client";

import { Catalog } from "@/components/catalog";
import { Constellation } from "@/components/constellation";
import { HexMark } from "@/components/landing";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { WalletSheet } from "@/components/wallet-sheet";
import { useHive } from "@/lib/use-hive";
import { formatCredits, formatGB } from "@/lib/utils";
import Link from "next/link";
import { useMemo, useState } from "react";

export function HiveRoom({ code }: { code: string }) {
  const hive = useHive(code);
  const [walletOpen, setWalletOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const unlockedLive = useMemo(
    () => hive.catalog.filter((m) => m.unlocked && m.live),
    [hive.catalog],
  );

  const canPrompt = unlockedLive.length > 0 && (hive.wallet?.balance ?? 0) + (hive.payFromPool ? hive.wallet?.poolBalance ?? 0 : 0) > 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-3 py-3 sm:px-5">
      <header className="flex flex-wrap items-center gap-3 rounded-3xl border border-line bg-bg-elev/80 px-3 py-3 backdrop-blur sm:px-4">
        <Link href="/" className="flex items-center gap-2 text-honey">
          <HexMark className="h-5 w-5" />
          <span className="font-semibold">Hive</span>
        </Link>
        <div className="font-mono text-sm tracking-[0.25em] text-ink">{hive.code}</div>
        <p className="hidden text-sm text-muted md:block">
          {hive.pool ? `${hive.pool.sharing} sharing · ${formatGB(hive.pool.pooledMB)} pooled` : "Connecting…"}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Switch
            checked={hive.sharing}
            onCheckedChange={hive.setSharing}
            label={hive.sharing ? "I'm in — earning" : "Share compute"}
          />
          <button
            type="button"
            onClick={() => setWalletOpen(true)}
            className="rounded-full border border-line px-3 py-2 font-mono text-sm hover:border-honey/50"
          >
            ₳{formatCredits(hive.wallet?.balance ?? 0)}
            {hive.wallet?.testMode ? <span className="ml-2 text-[10px] text-honey">TEST</span> : null}
          </button>
        </div>
      </header>

      {hive.probe ? (
        <p className="mt-3 rounded-2xl border border-line px-3 py-2 text-xs text-muted">
          Device fit: {hive.probe.kind} · {formatGB(hive.probe.vramMB)} estimated · {hive.probe.webgpu ? "WebGPU on" : "CPU kernel"} — {hive.probe.note}
        </p>
      ) : null}

      {hive.error ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <p>{hive.error}</p>
          <Button size="sm" variant="ghost" onClick={hive.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="mt-3 grid flex-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <section className="hive-panel flex min-h-[420px] flex-col rounded-3xl p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Room</p>
            {hive.status ? <p className="truncate text-xs text-honey">{hive.status}</p> : null}
          </div>

          <div className="mt-3 flex-1 space-y-3 overflow-auto pr-1">
            {hive.messages.length === 0 ? (
              <EmptyRoom sharing={hive.sharing} unlocked={unlockedLive.length} />
            ) : (
              hive.messages.map((m) => (
                <article
                  key={m.id}
                  className={`max-w-[42rem] rounded-2xl px-4 py-3 ${
                    m.role === "you"
                      ? "ml-auto bg-honey/10"
                      : m.role === "system"
                        ? "text-muted"
                        : "bg-black/30"
                  }`}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                    {m.role === "you" ? m.authorName || "You" : m.role === "swarm" ? `Swarm · ${m.modelId}` : "Hive"}
                    {m.live ? " · live" : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">
                    {m.text || (m.live ? "…" : "")}
                  </p>
                </article>
              ))
            )}
          </div>

          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              hive.sendPrompt(draft);
              setDraft("");
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                unlockedLive.length === 0
                  ? "Catalog is locked — someone has to share compute"
                  : "Prompt the swarm. Every screen sees the words."
              }
              rows={2}
              className="flex-1 resize-none rounded-2xl px-4 py-3"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  hive.sendPrompt(draft);
                  setDraft("");
                }
              }}
            />
            <div className="flex flex-col gap-2">
              <Button type="submit" disabled={!canPrompt || hive.generating}>
                Send
              </Button>
              {hive.generating ? (
                <Button type="button" variant="danger" onClick={hive.abort}>
                  Stop
                </Button>
              ) : null}
            </div>
          </form>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={hive.payFromPool}
              onChange={(e) => hive.setPayFromPool(e.target.checked)}
            />
            Spend from the office pool if my wallet runs out
          </label>
        </section>

        <aside className="flex flex-col gap-3">
          <Constellation members={hive.members} selfId={hive.selfId} />
          <Catalog
            catalog={hive.catalog}
            members={hive.members}
            selectedId={hive.selectedModelId || hive.pool?.activeModelId || null}
            onSelect={hive.selectModel}
          />
        </aside>
      </div>

      <WalletSheet
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        wallet={hive.wallet}
        history={hive.history}
        onTopUp={hive.topUp}
        onLightningConfirm={hive.confirmLightning}
      />
    </div>
  );
}

function EmptyRoom({ sharing, unlocked }: { sharing: boolean; unlocked: number }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center px-2 py-10">
      <p className="text-2xl font-semibold tracking-tight">Joining is the product.</p>
      <p className="mt-3 max-w-md text-muted">
        You are in the building. You do not have to share a GPU to sit here.
        {unlocked === 0
          ? " The catalog is grey until someone taps Share compute — then models unlock live, no reload."
          : sharing
            ? " You are a contributor. Your memory is in the pool and you earn as tokens move."
            : " Compute is already in the room. Type a prompt; contributors get paid per token."}
      </p>
    </div>
  );
}
