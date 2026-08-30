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
    <div className="sheet p-6" data-testid="catalog">
      <p className="label">Catalog</p>
      <p className="mt-2 text-[15px] leading-snug text-violet-soft" data-testid="catalog-headline">
        {catalogHeadline(members)}
      </p>
      <ul className="mt-4 space-y-2">
        {catalog.map((m) => {
          const selected = selectedId === m.id;
          return (
            <li key={m.id}>
              <button
                type="button"
                data-testid={`model-${m.id}`}
                data-unlocked={m.unlocked ? "true" : "false"}
                onClick={() => m.unlocked && m.live && onSelect(m.id)}
                disabled={!m.unlocked}
                className={cn(
                  "w-full rounded-[22px] px-4 py-3.5 text-left transition",
                  m.unlocked
                    ? selected
                      ? "glow-violet bg-violet/15"
                      : "bg-bg"
                    : "bg-bg/40 opacity-50",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("text-[15px] font-semibold", m.unlocked ? "text-ink" : "text-locked")}>
                    {m.name}
                  </span>
                  <span className="text-xs text-muted">
                    {m.params} · {formatGB(m.vramMB)}
                  </span>
                </div>
                <p className="mt-1 text-xs">
                  {m.unlocked ? (
                    <span className="text-ok">{m.live ? "Unlocked" : "Unlocked · protocol only"}</span>
                  ) : (
                    <span className="text-locked">{m.hint}</span>
                  )}
                  {m.unlocked && selected ? <span className="text-violet-soft"> · selected</span> : null}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
