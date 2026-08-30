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
npm run dev
```

Then open [http://127.0.0.1:43177](http://127.0.0.1:43177).

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
npm test
```

Layer assignment (memory budgets, more workers than layers, single-device WebLLM placement), ledger reserve/split/release, catalog unlock and fallback, and a real Nano forward pass on the vendored checkpoint.

## Project layout

```
src/lib/models.ts          catalog + unlock
src/lib/assign.ts          pipeline / single-device placement
src/lib/ledger.ts          instant credit math
src/lib/engine/            llama2.c-style kernel, tokenizer, WebLLM
src/server/hub.ts          presence, assignment, settlement
src/app/api/signal         SSE + POST signaling
src/components/hive-room   the group is the product
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs that keep the join-then-unlock loop intact are welcome.

## Acknowledgments

Hive Nano uses the `stories260K` / `tok512` export from [karpathy/tinyllamas](https://huggingface.co/karpathy/tinyllamas) (llama2.c). Qwen checkpoints are loaded at runtime via MLC WebLLM when selected. See [NOTICE](./NOTICE).

## Make this repository public

This Origin repo was created **private**. The `origin` CLI in this environment cannot flip visibility.

**Repo:** https://origin.cursor.com/mike-holborn/tmp-7f0ce07852d4181e  
**Clone:** `https://origin.cursor.com/mike-holborn/tmp-7f0ce07852d4181e.git`

**Origin (Cursor) click-path**

1. Open the repo URL above while logged in as the owner (Mike Holborn).
2. Open **Settings** (gear) on the repository.
3. Find **Visibility** / **Danger zone**.
4. Change visibility from **Private** to **Public**.
5. Confirm.

If you publish a GitHub copy from the Cursor **Create repo** control:

1. GitHub → the new repo → **Settings**.
2. Scroll to **Danger Zone**.
3. **Change repository visibility** → **Public** → confirm.

Until that switch is flipped, other people cannot star or clone it.
