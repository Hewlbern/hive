# Hive

Your building can run a 27B. Pay the people whose phones make it possible.

Hive is a **building-scale mesh inference** app. People join a group with a short code. Sharing a GPU is optional. Models unlock from the **pooled memory of whoever is sharing right now**. Tokens stream to every screen. Contributors are paid **per token, instantly**.

This is a remake of the SwarmLLM *idea* — not their product, not their assets, not their protocol.

## The core loop

1. **Join a group.** Code or link. No account. You can sit in the room without lending compute.
2. **Optionally share compute.** A phone or laptop taps *Share compute* and becomes a contributor. Their estimated WebGPU / CPU memory enters the pool.
3. **The catalog unlocks live.** One phone opens Hive Nano. A laptop opens Qwen 0.5B–7B (if it has WebGPU and the VRAM). A busy office unlocks the 14B / 27B slots. Locked models stay visible, greyed, with what it would take (“another laptop, or two more phones”).
4. **Prompt.** Anyone with credits can prompt. Generation uses the group’s pooled workers. If the active model no longer fits when someone leaves, Hive warns and falls back to the largest live model that still fits.
5. **Settle as words appear.** 1 credit = 1 generated token. The requester is reserved on Send, then workers are paid per token in proportion to layers held.

Roles:

- **Member** (default) — can prompt, watch the swarm, see the catalog.
- **Contributor** — member + share toggle on. Gets paid. Memory counts toward unlocks.
- A device can be both.

## What actually runs

| Model | Live? | How it runs |
| --- | --- | --- |
| **Hive Nano** (260K, 5 layers) | Yes | Real Llama-style kernel, layer-split over the mesh. Weights are in `public/models/`. |
| **Hive 15** (15M, 6 layers) | Yes | Same kernel. Downloads ~60 MB from Hugging Face on first use, cached in Cache Storage. |
| **Qwen 2.5 0.5B / 1.5B / 3B / 7B** 4-bit | Yes, if a sharing device has WebGPU *and* enough VRAM | [WebLLM](https://github.com/mlc-ai/web-llm) on that one device. Tokens still fan out to the group. WebLLM cannot layer-split. |
| **Qwen 2.5 14B / Qwen 3 27B** 4-bit | Protocol only | Assignment + unlock math is live. This build will not load those checkpoints. Selecting them falls back to the largest live model, with a clear warning. |

Single-device mode works: one laptop sharing can run the whole Nano (or Qwen, if it fits).

A fake 27B tokenizer is **not** the generate path. Nano’s `generate()` is a real forward pass on real weights. On WebGPU-capable machines, Qwen is a real WebLLM `chat.completions` call.

## Run locally

```bash
npm i
npm test
npm run dev
```

Open [http://127.0.0.1:43177/hive/HIVE](http://127.0.0.1:43177/hive/HIVE) in two browsers.

1. Tab A: tap **Share compute**.
2. Watch the catalog unlock (Nano, then Hive 15; Qwen if the machine reports enough VRAM).
3. Tab B: type a prompt. You do **not** need to share.
4. Tokens appear on both screens. A’s earnings tick up; B’s credits tick down.
5. A third tab at a phone viewport can join as a contributor.

The seeded building code `HIVE` always exists and ships with an office pool of test credits.

## Payments

The unit of account is a **prepaid swarm credit**. **1 credit ≈ 1 generated token.** There is no Stripe round-trip per token — the ledger is local and instant.

- Every new device wallet starts with **400 TEST credits**.
- Building `HIVE` starts with a **5,000 credit office pool**. Members can spend from it when their wallet is short.
- Top-up packs: **$5 → 500**, **$20 → 2,200**, **$50 → 6,000**.
- **Demo rail (default):** one tap credits the wallet. Clearly marked TEST.
- **Stripe test mode:** set the keys below. `/api/topup` creates a PaymentIntent; `/api/webhook/stripe` credits the ledger.
- **Lightning:** set LNbits, or use the test invoice + “I paid”. WebLN can be pointed at the bolt11.

Copy `.env.example` to `.env.local`:

```
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
LNBITS_URL=
LNBITS_ADMIN_KEY=
```

## Office-building networking

The original “same room, four-letter code, no servers” design dies across VLANs, guest Wi-Fi, and phone LTE. Hive uses a **signaling server** (this Next.js app: SSE + POST on `/api/signal`).

It carries join/leave, SDP/ICE, layer assignment, and payment events. **Weights and hidden states do not transit the server** when WebRTC is up. If a NAT blocks data channels, activations fall back over signaling so the demo still completes, and the UI stays honest.

**STUN** is on by default (`stun.l.google.com`) so two tabs on one machine always connect.

**TURN** is how you survive office NATs. Point Hive at Metered, Twilio, or the bundled coturn:

```
NEXT_PUBLIC_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
NEXT_PUBLIC_TURN_URL=turn:127.0.0.1:3478
NEXT_PUBLIC_TURN_USERNAME=hive
NEXT_PUBLIC_TURN_CREDENTIAL=hive-dev
```

```bash
docker compose up -d
```

Vercel can host the UI and the ledger API. Persistent SSE/WebSocket across many instances needs a dedicated signaling process (or Durable Objects / PartyKit). One Node process is enough for a single office.

## iOS / Safari

- **Join, watch, prompt, get paid:** works.
- **WebGPU:** present on recent Safari / iOS, but memory is tight. Hive treats those devices as small contributors. Qwen will stay locked unless a laptop is sharing.
- **WebRTC:** guest Wi-Fi and LTE often need TURN.
- Installable as a PWA (Add to Home Screen).

## Tests

```bash
npm test
```

Covers layer assignment (memory budgets, more devices than layers, single-device WebLLM placement), ledger splits and reserves, catalog unlock / fallback, and a real Nano forward pass on the vendored checkpoint.

## Stack

Next.js App Router, TypeScript, Tailwind. Signaling and ledger live in the same Node process. WebRTC is native `RTCPeerConnection`. No account required to join.
