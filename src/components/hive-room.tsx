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

  const spendable =
    (hive.wallet?.balance ?? 0) + (hive.payFromPool ? hive.wallet?.poolBalance ?? 0 : 0);
  const canPrompt = unlockedLive.length > 0 && spendable > 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-4 sm:px-6" data-connected={hive.connected ? "true" : "false"}>
      <header className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <HexMark className="h-5 w-5" />
          <span className="font-semibold">Hive</span>
        </Link>
        <div className="rounded-full bg-bg-elev px-3 py-1 font-semibold tracking-[0.2em]" data-testid="group-code">
          {hive.code}
        </div>
        <button
          type="button"
          data-testid="wallet-open"
          onClick={() => setWalletOpen(true)}
          className="ml-auto rounded-full bg-bg-elev px-4 py-2"
        >
          <span className="label block text-left">Balance</span>
          <span className="text-lg font-semibold leading-none text-violet-soft" data-testid="balance">
            {formatCredits(hive.wallet?.balance ?? 0)}
            <span className="ml-1 text-xs font-medium text-muted">cr</span>
          </span>
        </button>
      </header>

      {hive.error ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-[24px] bg-danger/10 px-4 py-3 text-sm text-danger" data-testid="error-banner">
          <p>{hive.error}</p>
          <Button size="sm" variant="ghost" onClick={hive.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid flex-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <section className="sheet glow-violet p-6" data-testid="contributor-card">
            <p className="label">Share compute</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <Switch
                checked={hive.sharing}
                onCheckedChange={hive.setSharing}
                label={hive.sharing ? "You're in" : "I'm in"}
              />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <p className="label">Earned</p>
                <p
                  className="mt-1 text-4xl font-semibold tracking-tight"
                  data-testid="earnings"
                  data-earned={Math.max(hive.wallet?.sessionEarned ?? 0, hive.me?.earnedSession ?? 0)}
                >
                  {formatCredits(Math.max(hive.wallet?.sessionEarned ?? 0, hive.me?.earnedSession ?? 0))}
                </p>
              </div>
              <div>
                <p className="label">Pooled</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight" data-testid="pooled">
                  {formatGB(hive.pool?.pooledMB ?? 0)}
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">
              {hive.sharing
                ? "Your memory is in the pool. You earn as tokens move."
                : "Optional. Join is free — models unlock when someone shares."}
            </p>
          </section>

          <Catalog
            catalog={hive.catalog}
            members={hive.members}
            selectedId={hive.selectedModelId || hive.pool?.activeModelId || null}
            onSelect={hive.selectModel}
          />
          <div className="hidden lg:block">
            <Constellation members={hive.members} selfId={hive.selfId} />
          </div>
        </div>

        <section className="sheet flex min-h-[420px] flex-col p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="label">Room</p>
            {hive.status ? <p className="truncate text-sm text-violet-soft">{hive.status}</p> : null}
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-auto pr-1" data-testid="token-stream">
            {hive.messages.length === 0 ? (
              <EmptyRoom sharing={hive.sharing} unlocked={unlockedLive.length} />
            ) : (
              hive.messages.map((m) => (
                <article
                  key={m.id}
                  data-testid={m.role === "swarm" ? "swarm-message" : "user-message"}
                  className={`max-w-[42rem] rounded-[22px] px-4 py-3 ${
                    m.role === "you" ? "ml-auto bg-violet/15" : "bg-bg"
                  }`}
                >
                  <p className="label">
                    {m.role === "you" ? m.authorName || "You" : m.role === "swarm" ? `Swarm · ${m.modelId}` : "Hive"}
                    {m.live ? " · live" : ""}
                  </p>
                  <p
                    className="mt-2 text-[22px] leading-snug font-medium whitespace-pre-wrap"
                    data-role={m.role}
                    data-testid={m.role === "swarm" ? "swarm-text" : "user-text"}
                  >
                    {m.text || (m.live ? "…" : "")}
                  </p>
                </article>
              ))
            )}
          </div>

          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              hive.sendPrompt(draft);
              setDraft("");
            }}
          >
            <label className="label" htmlFor="prompt">
              Prompt
            </label>
            <div className="mt-2 flex items-end gap-2 border-b border-line pb-2">
              <textarea
                id="prompt"
                data-testid="prompt-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={unlockedLive.length === 0 ? "Waiting for compute…" : "Ask the building"}
                rows={2}
                className="flex-1 resize-none border-0 bg-transparent text-2xl font-medium shadow-none focus:shadow-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    hive.sendPrompt(draft);
                    setDraft("");
                  }
                }}
              />
              <span className="mb-2 shrink-0 text-sm text-muted">1 cr / tok</span>
            </div>
            <Button
              type="submit"
              className="mt-4 w-full"
              disabled={!canPrompt || hive.generating}
              data-testid="prompt-send"
            >
              {hive.generating ? "Thinking…" : "Send"}
            </Button>
            {hive.generating ? (
              <Button type="button" variant="danger" className="mt-2 w-full" onClick={hive.abort}>
                Stop
              </Button>
            ) : null}
            <label className="mt-3 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={hive.payFromPool}
                onChange={(e) => hive.setPayFromPool(e.target.checked)}
              />
              Use the office pool if my wallet runs out
            </label>
          </form>
        </section>
      </div>

      <div className="mt-4 lg:hidden">
        <Constellation members={hive.members} selfId={hive.selfId} />
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
    <div className="flex flex-1 flex-col justify-center py-8">
      <p className="text-3xl font-semibold tracking-tight">You're in.</p>
      <p className="mt-3 max-w-md text-[16px] leading-relaxed text-muted">
        {unlocked === 0
          ? "The catalog stays locked until someone shares compute. Tap I'm in if this device can help."
          : sharing
            ? "You're a contributor. Earnings tick up as the room thinks."
            : "Compute is in the room. Type a prompt — contributors get paid per token."}
      </p>
    </div>
  );
}
