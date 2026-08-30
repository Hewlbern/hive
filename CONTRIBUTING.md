# Contributing to Hive

Hive is open source. The product mechanic to protect is:

**Join a group first. Sharing compute is optional. Models unlock from the pooled memory of whoever is sharing right now.**

If a change makes people pick a model before they have a group, or hides locked models, or requires an account to sit in a room, it is the wrong change.

## Dev setup

```bash
git clone <this-repo>
cd hive
npm i
cp .env.example .env.local   # leave keys empty; the demo wallet works
npm test
npm run dev
```

App: http://127.0.0.1:43177  
Seeded building: http://127.0.0.1:43177/hive/HIVE

Never commit `.env`, `.env.local`, Stripe keys, LNbits keys, or TURN credentials. `.env.example` is the only env file that belongs in git.

## How to check your change

1. Two browser tabs on `/hive/HIVE` (or two browsers, so they get different device ids).
2. Tab A shares compute. The catalog must unlock without a reload.
3. Tab B prompts without sharing. Tokens appear on both screens. Credits move.
4. A phone-width viewport can still join and share.
5. `npm test` stays green. The tests that matter most are layer assignment, ledger splits, and catalog unlock.

## Where to work

| Area | Start here |
| --- | --- |
| Unlock / catalog | `src/lib/models.ts`, `src/lib/models.test.ts` |
| Layer assignment | `src/lib/assign.ts`, `src/lib/assign.test.ts` |
| Credits | `src/lib/ledger.ts`, `src/server/ledger-store.ts` |
| Signaling / presence | `src/server/hub.ts`, `src/app/api/signal/route.ts` |
| Inference kernel | `src/lib/engine/` |
| Room UI | `src/components/hive-room.tsx`, `catalog.tsx`, `constellation.tsx` |

## Patches we want

- Better NAT / TURN defaults and diagnostics
- Real sharded downloads for larger hive-kernel checkpoints
- Pipeline-parallel kernels that can actually run 7B+ across devices
- Tests for roster races (join, share, leave, fallback)
- iOS Safari honesty: WebGPU limits, still able to contribute Nano

## Patches we do not want

- Scraped SwarmLLM assets, copy, or protocol
- A marketplace, accounts-required join, or “settle later” billing
- Secrets, analytics SDKs that phone home, or telemetry by default
- A fake 27B generate path that only tokenizes

## Pull requests

Keep the PR small and say which loop you touched: join, share, unlock, generate, or pay. Include a screenshot or a test when the catalog or ledger changes.

This project is MIT. By opening a PR you agree to license your contribution under the same license.
