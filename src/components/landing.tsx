"use client";

import { buildingCode } from "@/lib/probe";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./ui/button";

export function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function start() {
    router.push(`/hive/${buildingCode()}`);
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const next = (code || "HIVE").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (next) router.push(`/hive/${next}`);
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-honey">
          <HexMark />
          <span className="text-lg font-semibold tracking-tight">Hive</span>
        </div>
        <a
          href="/hive/HIVE"
          className="font-mono text-xs uppercase tracking-[0.2em] text-muted hover:text-honey"
        >
          Open demo building HIVE
        </a>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-14 py-16 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.28em] text-honey">
            Building-scale mesh inference
          </p>
          <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            Your building can run a 27B.
            <span className="block text-honey">
              Pay the people whose phones make it possible.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Join a group first. Sharing compute is optional. Models unlock as the
            office pools WebGPU memory — one phone opens Nano, a handful of
            laptops opens 7B, a busy floor opens 27B.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" onClick={start}>
              Start a building swarm
            </Button>
            <form onSubmit={join} className="flex flex-1 gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Join with a code"
                maxLength={8}
                className="h-12 w-full rounded-full px-5 font-mono tracking-[0.3em] sm:max-w-[220px]"
                aria-label="Building code"
              />
              <Button type="submit" variant="line" size="lg">
                Enter
              </Button>
            </form>
          </div>
        </div>

        <ol className="grid max-w-md gap-4 text-sm">
          <Step n="01" title="Join the group">
            A short code, or a link. No account. You can watch and prompt without
            lending a GPU.
          </Step>
          <Step n="02" title="Someone shares">
            Phones and laptops tap Share compute. Their memory unlocks the
            catalog in real time.
          </Step>
          <Step n="03" title="Pay as you generate">
            1 credit = 1 token. The requester is debited as words appear.
            Contributors get paid the same instant.
          </Step>
        </ol>
      </main>

      <footer className="flex flex-col gap-2 border-t border-line pt-6 text-xs text-muted sm:flex-row sm:justify-between">
        <p>Not affiliated with SwarmLLM. New protocol, new name, new rail.</p>
        <p className="font-mono">STUN default · TURN via env · demo wallet if Stripe is unset</p>
      </footer>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="hive-panel rounded-2xl p-4">
      <p className="font-mono text-[11px] text-honey">{n}</p>
      <p className="mt-1 text-base text-ink">{title}</p>
      <p className="mt-1 text-muted">{children}</p>
    </li>
  );
}

export function HexMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 2.4 20.5 7.2v9.6L12 21.6 3.5 16.8V7.2L12 2.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 7.2 16.2 9.6v4.8L12 16.8 7.8 14.4V9.6L12 7.2Z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}
