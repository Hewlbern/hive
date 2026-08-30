"use client";

import { buildingCode } from "@/lib/probe";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";

export function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("HIVE");

  function start() {
    router.push(`/hive/${buildingCode()}`);
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const next = (code || "HIVE").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (next) router.push(`/hive/${next}`);
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-ink">
          <HexMark />
          <span className="text-[17px] font-semibold tracking-tight">Hive</span>
        </div>
        <a href="/hive/HIVE" className="text-sm text-muted hover:text-violet-soft">
          Open HIVE
        </a>
      </header>

      <main className="flex flex-1 flex-col justify-center py-10">
        <p className="label text-center">Building swarm</p>
        <h1 className="mt-3 text-center text-[34px] leading-[1.12] font-semibold tracking-tight sm:text-5xl">
          Your building can run a 27B
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-center text-[16px] leading-relaxed text-muted">
          Join a group. Share a phone if you want. Models unlock as the office pools memory — and contributors get paid per token.
        </p>

        <form onSubmit={join} className="sheet glow-violet mx-auto mt-10 w-full p-6 sm:p-8">
          <label className="label" htmlFor="join-code">
            Group code
          </label>
          <div className="mt-3 flex items-end gap-3 border-b border-line pb-2">
            <input
              id="join-code"
              data-testid="join-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              className="h-16 w-full border-0 bg-transparent text-5xl font-semibold tracking-[0.18em] shadow-none focus:shadow-none"
              aria-label="Building code"
              autoComplete="off"
            />
            <span className="mb-2 shrink-0 text-sm text-muted">code</span>
          </div>
          <Button type="submit" size="lg" className="mt-6 w-full" data-testid="join-submit">
            Join group
          </Button>
          <p className="mt-3 text-center text-sm text-muted">No account. Sharing compute is optional.</p>
        </form>

        <button
          type="button"
          data-testid="start-swarm"
          onClick={start}
          className="mt-6 text-center text-[15px] font-semibold text-violet-soft hover:text-violet"
        >
          Start a new building
        </button>
      </main>

      <footer className="pb-2 text-center text-xs text-muted">
        Independent remake. MIT. Not affiliated with SwarmLLM or MoonPay.
      </footer>
    </div>
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
        fill="#7c5cff"
      />
    </svg>
  );
}
