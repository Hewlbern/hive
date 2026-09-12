# Friends over Hive MCP (Grok Bot)

Hive pods already have an identity: the **device id** (`hive.deviceId` in the browser, `~/.config/hive/device_id` on the desktop app). Friends reuse that id. There is no second account system.

Friendship is **bidirectional after accept**. Sharing is **opt-in only**. Connecting two Grok Bots to Hive MCP does **not** dump chat, roster, wallet, activations, or prompts. A pod only sees payloads another friend explicitly sent to it.

## Privacy defaults

| Rule | Behavior |
| --- | --- |
| Default deny | Not friends → cannot share or pull |
| Pending ≠ friends | A request does not unlock shares |
| Explicit body | `hive_share_with_friend` requires `body`. Empty / omitted fails |
| No ambient dump | There is no tool that shares “current context” |
| Addressed | A share has `fromId` + `toId`. Third pods cannot pull it |
| Revoke | Either side can revoke. Shares between the pair are dropped |
| TTL | Optional `ttlSeconds`; expired shares disappear from pull |
| Scopes | `note` (default), `fact`, `context`, plus an optional `label` |

## Where it persists

| Surface | Store |
| --- | --- |
| Hive web hub (MCP + `/api/friends`) | `data/friends.json` (`HIVE_FRIENDS_PATH`) |
| Desktop / hive-core | `~/.config/hive/friends.json` via `FriendStore` (same model; UI can use it later) |

The MCP tools wrap the hub store. Two Grok Bots that should see each other must hit **the same hub**.

## Point Grok Bot at Hive

Hive speaks **Streamable HTTP** JSON-RPC (stateless), same shape as [xAI remote MCP](https://docs.x.ai/developers/tools/remote-mcp).

1. Run the Hive hub (`npm start` or a public HTTPS deploy).
2. In Grok Bot → Plugins → add a custom MCP server:
   - **URL:** `https://<your-hive>/api/mcp` (alias: `/mcp`)
   - **Header:** `X-Hive-Pod-Id` = this bot’s Hive device id  
     (local: `localStorage.hive.deviceId` or `cat ~/.config/hive/device_id`)
3. Probe without auth: `GET https://<your-hive>/api/mcp` or `/.well-known/mcp/server-card.json`.

Account-wide plugin headers are shared across bots. For **two Grok Bots on one account**, put each pod id in that bot’s instructions and pass `podId` on every tool call (it overrides the header / `HIVE_POD_ID`).

Cursor IDE / xAI SDK:

```json
{
  "type": "mcp",
  "server_url": "https://<your-hive>/api/mcp",
  "server_label": "hive",
  "server_description": "Hive pod friends and opt-in shares",
  "headers": { "X-Hive-Pod-Id": "<this-pod-device-id>" }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `hive_whoami` | Confirm this pod’s device id |
| `hive_list_friends` | Accepted friends + incoming / outgoing requests |
| `hive_friend_request` | `peerId` (+ optional `name`). Mutual request auto-accepts |
| `hive_friend_accept` | Accept an incoming request (`peerId`) |
| `hive_friend_revoke` | Revoke or cancel (`peerId`) |
| `hive_share_with_friend` | `peerId`, **required** `body`, optional `scope`, `label`, `ttlSeconds` |
| `hive_pull_friend_shares` | Inbound opt-in shares only; optional `fromId` / `scope` / `label` |

Resources (same data, read-only): `hive://whoami`, `hive://friends`, `hive://shares`.

## End-to-end: two Grok Bots

Bot A (pod `aaa…`, header or `podId`) and Bot B (pod `bbb…`) on the same hub.

1. **A whoami** — `hive_whoami` → `{ "podId": "aaa…" }`. Operators exchange ids in chat (explicit).
2. **A requests B** — `hive_friend_request` `{ "peerId": "bbb…" }`.
3. **B lists** — `hive_list_friends` → `incoming: [{ peerId: "aaa…" }]`.
4. **B accepts** — `hive_friend_accept` `{ "peerId": "aaa…" }`. Now bidirectional.
5. **A shares a fact** — `hive_share_with_friend`  
   `{ "peerId": "bbb…", "body": "Office pool: 12 GB, Nano unlocked", "scope": "fact", "label": "pool" }`  
   Do **not** paste the rest of the thread or the roster.
6. **B pulls** — `hive_pull_friend_shares` `{ "fromId": "aaa…" }` → only that body.
7. **Either revokes** — `hive_friend_revoke` `{ "peerId": "…" }`. Pulls go empty. Re-friending does not restore old shares.

### curl (same JSON-RPC Grok sends)

```bash
HUB=http://127.0.0.1:43177/api/mcp

curl -s -X POST "$HUB" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-Hive-Pod-Id: pod-a' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hive_friend_request","arguments":{"peerId":"pod-b"}}}'

curl -s -X POST "$HUB" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-Hive-Pod-Id: pod-b' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"hive_friend_accept","arguments":{"peerId":"pod-a"}}}'

curl -s -X POST "$HUB" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-Hive-Pod-Id: pod-a' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"hive_share_with_friend","arguments":{"peerId":"pod-b","body":"Nano unlocked","scope":"fact"}}}'

curl -s -X POST "$HUB" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-Hive-Pod-Id: pod-b' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"hive_pull_friend_shares","arguments":{}}}'
```

REST (same store, for scripts / a future UI): `GET /api/friends?podId=` and `POST /api/friends` with `op`: `request` | `accept` | `revoke` | `share` | `pull`.

## Operator checklist

- Public HTTPS URL if Grok Bot is the cloud path (localhost is fine for Cursor IDE + `npm start`).
- Never put tokens or `.env` values in a share body.
- Treat `peerId` as a device id, not a Discord username (Discord pairing stays `dc:<guild>` + `/share`).
- Friendship is not compute-sharing. *Share compute* in the room is unchanged.
