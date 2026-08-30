# Hive

**Your building can run a 27B. Pay the people whose phones make it possible.**

Hive is an open-source, building-scale **mesh inference** app. People join a group with a short code or link. Sharing a GPU is optional. The model catalog unlocks from the **pooled memory of whoever is sharing right now**. Hidden states move peer-to-peer. Contributors are paid **per token, instantly**.

License: [MIT](./LICENSE) · Copyright 2026 Mike Holborn / Hive

> This is a remake of an idea, not a clone. New name, new visual identity, new protocol. Not affiliated with SwarmLLM. Do not copy their assets.

## Why

Phones cannot hold a 27B. A floor of phones, laptops, and desktops might. The original same-room, no-server demo dies the moment someone is on guest Wi-Fi or LTE two floors down. And people will not lend a phone GPU for an IOU that settles next week.

Hive is the opposite loop:

1. **Join the group.** That is the product. No account. You can watch and prompt without lending compute.
2. **Optionally share.** A device that taps *Share compute* becomes a contributor. Its estimated VRAM enters the pool.
3. **Unlock what the room can actually run.** One phone opens a tiny model. A handful of laptops open 7B. A busy office unlocks the 14B / 27B slots. Locked models stay visible, greyed, with what it would take.
4. **Pay as words appear.** 1 credit = 1 token. The requester is reserved on Send. Workers are paid on each token, split by layers held.

## Architecture

```
  phones / laptops / desktops
           │  join code or /hive/HIVE
           ▼
     signaling (this app)
     SSE + POST /api/signal
     join · leave · SDP/ICE · assignment · pay events
           │
           ├─ WebRTC data channels ── activations (fp32 hidden states)
           │                          tokens also fan out on signaling
           │
           └─ ledger (JSON file)
              instant debit/credit, no Stripe per token
```

**Group join, then compute.** A member is in the building even at 0 GB shared. Their presence does not unlock models. A contributor’s memory does.

**Catalog gated by pooled VRAM.** `src/lib/models.ts` sums sharing devices. Pipeline models (Hive Nano / Hive 15) unlock from the *sum*. WebLLM models unlock when *one* sharing device has WebGPU and enough VRAM. 14B / 27B use the same unlock math; this build will not load those checkpoints and falls back honestly.

**WebRTC layer-split.** `src/lib/assign.ts` gives each contributor a contiguous layer range, bigger devices more layers. The hive-kernel runs those layers locally and sends the hidden state to the next hop. Single-device mode is the same kernel with one assignment covering every layer.

**Instant credits.** `src/lib/ledger.ts` is the unit of account. Stripe / Lightning are top-up rails only. If keys are missing, the demo wallet still settles in milliseconds and is marked TEST.

Signaling never carries model weights when Cache Storage / the CDN can serve them. Activations stay on data channels when ICE works; they fall back over signaling if a NAT blocks P2P so the demo still finishes.

## What actually runs

| Model | Live? | How it runs |
| --- | --- | --- |
| **Hive Nano** (260K, 5 layers) | Yes | Real Llama-style kernel. Weights in `public/models/`. Layer-split ready. |
| **Hive 15** (15M, 6 layers) | Yes | Same kernel. ~60 MB from Hugging Face on first use, cached. |
| **Qwen 2.5 0.5B–7B** 4-bit | Yes, if one sharing device has WebGPU + VRAM | [WebLLM](https://github.com/mlc-ai/web-llm) on that device. Tokens still fan out. |
| **Qwen 2.5 14B / Qwen 3 27B** 4-bit | Protocol only | Unlock + assignment are live. Selecting them falls back to the largest live model. |

A simulated 27B tokenizer is not the generate path.

## Run locally

```bash
npm i
cp .env.example .env.local    # optional; empty keys → demo wallet
npm test
npm run build && npm start    # preview on :43177 (preferred)
# npm run dev                 # turbopack; can 403 JS chunks in some agents/VMs
```

Then open [http://127.0.0.1:43177](http://127.0.0.1:43177).

## Desktop app (Tauri 2 + Rust)

We use **Tauri 2** (Rust core + system webview) instead of Electron so the desktop shell is actually written in Rust.

```bash
# needs Rust 1.98+ (see rust-toolchain.toml), system webview deps on Linux
npm i
npm run build && npm start          # terminal 1 — Hive web hub on :43177
cargo tauri dev                     # terminal 2 — desktop window + tray
# or: npm run desktop:dev
```

| OS | Notes |
| --- | --- |
| **macOS** | Xcode CLT. `cargo tauri dev` |
| **Linux** | `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf` |
| **Windows** | WebView2 runtime. Visual Studio C++ build tools. `cargo tauri dev` |

The window loads the existing Hive UI (`HIVE_URL`, default `http://127.0.0.1:43177`). Tray: toggle share, open window, quit. Mesh/inference stays in the webview.

```bash
cargo test -p hive-core
cargo test -p hive-discord
# npm run test:rust   # both (excludes GUI crate)
```

## Discord bot — share compute in a server

Same Rust workspace (`crates/hive-discord`, poise + serenity). A Discord **guild = a Hive swarm** with id `dc:<guild_id>`.

### Create the bot (Discord Developer Portal)

1. Open [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → name it `Hive`.
2. **Bot** → **Add Bot** → **Reset Token** → copy into `.env` as `DISCORD_BOT_TOKEN` (never commit it).
3. Under **Privileged Gateway Intents**, you can leave Message Content off (slash commands only).
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`. Bot permissions: **Send Messages**, **Use Slash Commands**.
5. Copy the invite URL, open it, pick your server. Copy **Application ID** into `DISCORD_CLIENT_ID`.

### Run the bot

**Option A — inside the desktop app** (one host machine):

```bash
export DISCORD_BOT_TOKEN=...
export HIVE_URL=http://127.0.0.1:43177
cargo tauri dev
```

**Option B — always-on host:**

```bash
export DISCORD_BOT_TOKEN=...
export HIVE_URL=http://127.0.0.1:43177
cargo run -p hive-discord
# or: npm run discord
```

### Slash commands

| Command | What it does |
| --- | --- |
| `/hive` | Who’s sharing, pooled MB, unlocked / next model |
| `/share code:XXXXXX` | Pair desktop ↔ Discord user, mark share ON for this guild |
| `/unshare` | Stop contributing this machine |
| `/ask prompt:` | Run a prompt on the guild swarm (needs sharers) |

### 60-second walkthrough

1. Start Hive web (`npm start`) + bot (`cargo run -p hive-discord` or desktop with token).
2. Invite the bot; in Discord run `/hive` — catalog locked.
3. On machine A: open desktop (or web), generate a pairing code via the Tauri `pairing_code` command / local API register, run `/share code:AAAAAA`.
4. On machine B: same with another code → `/share`.
5. `/hive` shows pooled MB and unlocked models.
6. Anyone runs `/ask prompt: Once upon a time` → tokens land in the channel.

Pairing codes are **consume-once**, TTL 10 minutes, stored in `~/.config/hive/pairing.json` and/or the hub (`/api/pairing/*`).

## How to join a group

- **Start a building:** landing page → *Start a building swarm* (random four-letter code).
- **Join with a code:** type the code on the landing page, or open `/hive/CODE`.
- **Seeded demo:** [`/hive/HIVE`](http://127.0.0.1:43177/hive/HIVE) always exists and ships an office pool of test credits.

In two browsers (or two profiles — same-origin localStorage is one device):

1. Both open `/hive/HIVE`. You are members. The catalog is locked.
2. Tab A taps **Share compute**. Nano / Hive 15 unlock immediately. Qwen unlocks if that machine reports enough WebGPU memory.
3. Tab B types a prompt. B does not need to share. Tokens appear on both screens.
4. A’s earnings tick up. B’s credits tick down. Top up from the ₳ wallet (TEST packs if Stripe is unset).
5. A third tab at a phone viewport can join as a contributor. More pooled memory unlocks more of the catalog.

## Environment variables

Copy `.env.example` to `.env.local`. **Never commit a real `.env`.**

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe test secret. Empty → demo wallet. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key. |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/api/webhook/stripe`. |
| `LNBITS_URL` / `LNBITS_ADMIN_KEY` | Real Lightning invoices. Empty → test invoice + *I paid*. |
| `NEXT_PUBLIC_STUN_URLS` | Default: Google STUN. Enough for two tabs on one machine. |
| `NEXT_PUBLIC_TURN_URL` | `turn:host:3478` (Metered, Twilio, or local coturn). |
| `NEXT_PUBLIC_TURN_USERNAME` / `NEXT_PUBLIC_TURN_CREDENTIAL` | TURN auth. |
| `HIVE_LEDGER_PATH` | Ledger JSON path. Default `data/ledger.json` (gitignored). |

```bash
# optional local TURN
docker compose up -d
# then set NEXT_PUBLIC_TURN_* to turn:127.0.0.1:3478 / hive / hive-dev
```

## Payments in test mode

- Unit: **1 credit = 1 generated token**.
- New device wallet: **400 TEST credits**.
- Building `HIVE` office pool: **5,000 credits**. Members can spend from the pool when their wallet is short.
- Packs: **$5 → 500**, **$20 → 2,200**, **$50 → 6,000**.
- **No Stripe keys:** the ₳ sheet is a one-tap demo rail, marked TEST. Credits appear immediately.
- **Stripe test mode:** `/api/topup` creates a PaymentIntent; the webhook credits the ledger. Use Stripe test cards.
- **Lightning:** LNbits if configured; otherwise a test bolt11 and *I paid (test)*.
- There is no “settle later” path and no marketplace.

## iOS / Safari

Join, watch, prompt, and get paid work. WebGPU is limited or missing; Hive treats those phones as small contributors (Nano still runs on CPU). Guest Wi-Fi and LTE usually need TURN. The app is a PWA (Add to Home Screen).

## Tests

```bash
npm test          # unit + functional + Playwright E2E
npm run test:unit # vitest only
npm run test:e2e  # Playwright against next start on :43188 (not turbopack)
npm run test:rust # cargo test -p hive-core -p hive-discord
```

Unit / functional (always run in CI and on this VM):

- Layer assignment given memory budgets
- Catalog unlock vs pooled VRAM, plus fallback when the pool shrinks
- Ledger reserve, split-by-layers, unused release
- Join / leave presence
- Share-compute catalog updates
- Prompt → token fan-out to every peer (fake kernel)
- Demo wallet top-up
- Out-of-credits refuse / mid-stream pause
- Real Nano forward pass on the vendored checkpoint

Playwright E2E: two Chromium contexts join `HIVE`, one shares, the buyer selects **Hive Nano** (vendored weights), prompts, both see token text, balances and earnings move. Hive 15 / WebLLM paths need network + WebGPU — run those manually locally. On this VM, `npm test` runs vitest + Playwright against `next start` on port **43188**.

UI references (MoonPay-grade restyle):

- [docs/ui/landing.png](docs/ui/landing.png)
- [docs/ui/group-room.png](docs/ui/group-room.png)
- [docs/ui/mobile-contributor.png](docs/ui/mobile-contributor.png)
- [docs/ui/wallet.png](docs/ui/wallet.png)

## Project layout

```
src/lib/models.ts          catalog + unlock
src/lib/swarm-id.ts        office codes + dc:<guildId>
src/lib/assign.ts          pipeline / single-device placement
src/lib/ledger.ts          instant credit math
src/lib/engine/            llama2.c-style kernel, tokenizer, WebLLM
src/server/hub.ts          presence, assignment, settlement
src/server/pairing-store.ts  Discord↔device pairing
src/app/api/signal         SSE + POST signaling
src/components/hive-room   the group is the product
crates/hive-core           guild map, pairing, catalog (Rust)
crates/hive-discord        slash commands + standalone binary
src-tauri                  Tauri 2 desktop shell + tray
desktop-ui                 tiny bootstrap page for packaged builds
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs that keep the join-then-unlock loop intact are welcome.

## Acknowledgments

Hive Nano uses the `stories260K` / `tok512` export from [karpathy/tinyllamas](https://huggingface.co/karpathy/tinyllamas) (llama2.c). Qwen checkpoints are loaded at runtime via MLC WebLLM when selected. See [NOTICE](./NOTICE).

## Public repository

**GitHub (public):** https://github.com/Hewlbern/hive  

```bash
git clone https://github.com/Hewlbern/hive.git
```

MIT licensed. Anyone can clone without auth.
