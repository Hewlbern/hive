"use client";

import { catalogHeadline } from "@/lib/models";
import type { CatalogEntryView, Member } from "@/lib/protocol";
import { cn, formatGB } from "@/lib/utils";

export function Catalog({
  catalog,
  members,
  selectedId,
  onSelect,
}: {
  catalog: CatalogEntryView[];
  members: Member[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="hive-panel rounded-3xl p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Catalog</p>
      <p className="mt-2 text-sm text-honey">{catalogHeadline(members)}</p>
      <ul className="mt-4 space-y-2">
        {catalog.map((m) => {
          const selected = selectedId === m.id;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => m.unlocked && m.live && onSelect(m.id)}
                disabled={!m.unlocked}
                className={cn(
                  "w-full rounded-2xl border px-3 py-3 text-left transition",
                  m.unlocked
                    ? selected
                      ? "hive-glow border-honey/70 bg-honey/10"
                      : "border-line hover:border-honey/40"
                    : "border-transparent bg-black/20 opacity-55",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("text-sm", m.unlocked ? "text-ink" : "text-locked")}>
                    {m.name}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {m.params} · {m.bits}-bit · {formatGB(m.vramMB)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px]">
                  {m.unlocked ? (
                    <span className="text-ok">
                      {m.live ? "Unlocked" : "Unlocked · protocol only"}
                    </span>
                  ) : (
                    <span className="text-locked">{m.hint}</span>
                  )}
                  {m.unlocked && selected ? <span className="text-honey"> · selected</span> : null}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
