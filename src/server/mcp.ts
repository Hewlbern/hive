import { FriendsError, normalizePodId } from "@/lib/friends";
import {
  acceptFriend,
  listFriendGraph,
  pullFriendShares,
  requestFriend,
  revokeFriend,
  shareWithFriend,
} from "./friends-store";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_DEFAULT_PROTOCOL = "2025-03-26";
export const MCP_SERVER_NAME = "hive";
export const MCP_SERVER_VERSION = "0.1.0";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const POD_ID_PROP = {
  type: "string",
  description:
    "This pod's Hive device id. Optional if X-Hive-Pod-Id or HIVE_POD_ID is set. Do not invent a new identifier.",
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "hive_whoami",
    description:
      "Return this Hive pod's device id (the existing Hive identity). Use this before friend or share calls so the operator knows which pod the bot is.",
    inputSchema: {
      type: "object",
      properties: { podId: POD_ID_PROP },
      additionalProperties: false,
    },
  },
  {
    name: "hive_list_friends",
    description:
      "List accepted friends and pending requests for this pod. Does not include other pods' graphs or any shared payloads.",
    inputSchema: {
      type: "object",
      properties: { podId: POD_ID_PROP },
      additionalProperties: false,
    },
  },
  {
    name: "hive_friend_request",
    description:
      "Send a friend request to another Hive pod (device id). Friendship stays pending until they accept. If they already requested you, this accepts and becomes bidirectional.",
    inputSchema: {
      type: "object",
      properties: {
        podId: POD_ID_PROP,
        peerId: {
          type: "string",
          description: "The other pod's Hive device id.",
        },
        name: {
          type: "string",
          description: "Optional display name for this requester (not an identity).",
        },
      },
      required: ["peerId"],
      additionalProperties: false,
    },
  },
  {
    name: "hive_friend_accept",
    description:
      "Accept a pending incoming friend request. After accept, both pods are friends and may opt into shares. Does not share any data by itself.",
    inputSchema: {
      type: "object",
      properties: {
        podId: POD_ID_PROP,
        peerId: { type: "string", description: "Pod that sent the request." },
      },
      required: ["peerId"],
      additionalProperties: false,
    },
  },
  {
    name: "hive_friend_revoke",
    description:
      "Revoke a friendship or cancel a pending request. Drops share visibility between the pair. Either side may revoke.",
    inputSchema: {
      type: "object",
      properties: {
        podId: POD_ID_PROP,
        peerId: { type: "string", description: "Friend or pending peer to revoke." },
      },
      required: ["peerId"],
      additionalProperties: false,
    },
  },
  {
    name: "hive_share_with_friend",
    description:
      "Share an explicit note, fact, or context snippet with an accepted friend. You MUST pass the exact body the operator opted into. Never attach chat history, wallet, roster, activations, prompts, or other ambient Hive state. Default deny if not friends.",
    inputSchema: {
      type: "object",
      properties: {
        podId: POD_ID_PROP,
        peerId: { type: "string", description: "Accepted friend to receive the share." },
        body: {
          type: "string",
          description: "Exact payload to share. Required. Opt-in only.",
        },
        scope: {
          type: "string",
          enum: ["note", "fact", "context"],
          description: "Share label. Default note.",
        },
        label: {
          type: "string",
          description: "Optional short tag the friend can filter on (e.g. standup, inventory).",
        },
        ttlSeconds: {
          type: "number",
          description: "Optional time-to-live in seconds. After expiry the friend can no longer pull this share.",
        },
      },
      required: ["peerId", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "hive_pull_friend_shares",
    description:
      "Pull inbound shares addressed to this pod from accepted friends. Returns only payloads those friends explicitly shared — never their full context.",
    inputSchema: {
      type: "object",
      properties: {
        podId: POD_ID_PROP,
        fromId: { type: "string", description: "Optional: only shares from this friend." },
        scope: { type: "string", enum: ["note", "fact", "context"] },
        label: { type: "string", description: "Optional label filter." },
      },
      additionalProperties: false,
    },
  },
];

export const MCP_RESOURCES = [
  {
    uri: "hive://whoami",
    name: "This pod",
    mimeType: "application/json",
    description: "This pod's Hive device id.",
  },
  {
    uri: "hive://friends",
    name: "Friends",
    mimeType: "application/json",
    description: "Accepted friends and pending requests for this pod.",
  },
  {
    uri: "hive://shares",
    name: "Inbound shares",
    mimeType: "application/json",
    description: "Only payloads friends explicitly shared with this pod.",
  },
];

export function resolvePodId(
  args: Record<string, unknown> | undefined,
  headers?: Headers | Record<string, string | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromArgs = typeof args?.podId === "string" ? args.podId : undefined;
  const headerGet = (name: string) => {
    if (!headers) return undefined;
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const rec = headers as Record<string, string | undefined>;
    return rec[name] ?? rec[name.toLowerCase()];
  };
  const fromHeader =
    headerGet("x-hive-pod-id") ??
    headerGet("X-Hive-Pod-Id") ??
    headerGet("x-hive-device-id") ??
    headerGet("X-Hive-Device-Id");
  const fromEnv = env.HIVE_POD_ID || env.HIVE_DEVICE_ID;
  const raw = fromArgs || fromHeader || fromEnv;
  return normalizePodId(raw);
}

function toolResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

function friendsErrorResult(err: unknown) {
  if (err instanceof FriendsError) {
    return toolResult({ ok: false, error: err.code, message: err.message }, true);
  }
  const message = err instanceof Error ? err.message : "internal error";
  return toolResult({ ok: false, error: "internal", message }, true);
}

export function callHiveTool(
  name: string,
  args: Record<string, unknown> = {},
  headers?: Headers | Record<string, string | undefined>,
): ReturnType<typeof toolResult> {
  try {
    switch (name) {
      case "hive_whoami": {
        const podId = resolvePodId(args, headers);
        return toolResult({
          podId,
          identity: "hive.deviceId",
          privacy:
            "Shares are opt-in only. Friendship does not grant roster, wallet, prompts, or activations.",
        });
      }
      case "hive_list_friends": {
        const podId = resolvePodId(args, headers);
        return toolResult({ ok: true, ...listFriendGraph(podId) });
      }
      case "hive_friend_request": {
        const podId = resolvePodId(args, headers);
        const peerId = String(args.peerId ?? "");
        const name = typeof args.name === "string" ? args.name : undefined;
        const friendship = requestFriend(podId, peerId, name);
        return toolResult({ ok: true, friendship });
      }
      case "hive_friend_accept": {
        const podId = resolvePodId(args, headers);
        const friendship = acceptFriend(podId, String(args.peerId ?? ""));
        return toolResult({ ok: true, friendship });
      }
      case "hive_friend_revoke": {
        const podId = resolvePodId(args, headers);
        const friendship = revokeFriend(podId, String(args.peerId ?? ""));
        return toolResult({ ok: true, friendship });
      }
      case "hive_share_with_friend": {
        const podId = resolvePodId(args, headers);
        const share = shareWithFriend(podId, String(args.peerId ?? ""), {
          body: String(args.body ?? ""),
          scope: typeof args.scope === "string" ? args.scope : undefined,
          label: typeof args.label === "string" ? args.label : undefined,
          ttlSeconds: typeof args.ttlSeconds === "number" ? args.ttlSeconds : undefined,
        });
        return toolResult({ ok: true, share });
      }
      case "hive_pull_friend_shares": {
        const podId = resolvePodId(args, headers);
        const shares = pullFriendShares(podId, {
          fromId: typeof args.fromId === "string" ? args.fromId : undefined,
          scope: typeof args.scope === "string" ? args.scope : undefined,
          label: typeof args.label === "string" ? args.label : undefined,
        });
        return toolResult({
          ok: true,
          podId,
          shares,
          note: "Only opt-in payloads friends addressed to this pod. No ambient mesh dump.",
        });
      }
      default:
        return toolResult({ ok: false, error: "unknown_tool", message: `unknown tool: ${name}` }, true);
    }
  } catch (err) {
    return friendsErrorResult(err);
  }
}

function readResource(
  uri: string,
  headers?: Headers | Record<string, string | undefined>,
  args?: Record<string, unknown>,
) {
  const podId = resolvePodId(args, headers);
  if (uri === "hive://whoami") {
    return { uri, mimeType: "application/json", text: JSON.stringify({ podId }) };
  }
  if (uri === "hive://friends") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(listFriendGraph(podId)),
    };
  }
  if (uri === "hive://shares") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify({ podId, shares: pullFriendShares(podId) }),
    };
  }
  throw new FriendsError("not_found", `unknown resource: ${uri}`);
}

export function handleJsonRpc(
  message: JsonRpcRequest,
  headers?: Headers | Record<string, string | undefined>,
): JsonRpcResponse | null {
  const id = message.id ?? null;
  const method = message.method;
  const params = message.params ?? {};

  if (message.id === undefined) {
    return null;
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = String(params.protocolVersion ?? MCP_DEFAULT_PROTOCOL);
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : MCP_DEFAULT_PROTOCOL;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
            },
            serverInfo: {
              name: MCP_SERVER_NAME,
              version: MCP_SERVER_VERSION,
              title: "Hive Friends",
            },
            instructions:
              "Hive friends are explicit trusted peers (device ids). Request/accept before sharing. Share only the exact note/fact/context the operator opts into — never dump ambient room, wallet, or chat state. Pull returns only inbound opt-in shares.",
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
      case "tools/call": {
        const name = String(params.name ?? "");
        const args =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        return { jsonrpc: "2.0", id, result: callHiveTool(name, args, headers) };
      }
      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: MCP_RESOURCES } };
      case "resources/templates/list":
        return { jsonrpc: "2.0", id, result: { resourceTemplates: [] } };
      case "resources/read": {
        const uri = String(params.uri ?? "");
        const contents = readResource(uri, headers, params);
        return { jsonrpc: "2.0", id, result: { contents: [contents] } };
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${String(method)}` },
        };
    }
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "internal error";
    return { jsonrpc: "2.0", id, error: { code: -32603, message: messageText } };
  }
}

export function mcpServerCard(baseUrl?: string) {
  const endpoint = baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/mcp` : "/api/mcp";
  return {
    name: MCP_SERVER_NAME,
    title: "Hive Friends",
    description:
      "Opt-in friend / trusted-peer sharing for Hive pods. Grok Bot can list, request, accept, revoke, share a labeled payload, and pull only what was shared.",
    version: MCP_SERVER_VERSION,
    transport: { type: "streamable-http", endpoint },
    authentication: {
      type: "none",
      identityHeaders: ["X-Hive-Pod-Id", "X-Hive-Device-Id"],
    },
    tools: MCP_TOOLS.map((t) => t.name),
    resources: MCP_RESOURCES.map((r) => r.uri),
    privacy: {
      default: "deny",
      shares: "explicit body only",
      ambientDump: false,
    },
  };
}

export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-Hive-Pod-Id, X-Hive-Device-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_DEFAULT_PROTOCOL,
      ...MCP_CORS_HEADERS,
      ...extra,
    },
  });
}

function sseResponse(body: unknown, extra: Record<string, string> = {}) {
  const payload = `event: message\ndata: ${JSON.stringify(body)}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "MCP-Protocol-Version": MCP_DEFAULT_PROTOCOL,
      ...MCP_CORS_HEADERS,
      ...extra,
    },
  });
}

function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  if (host && !host.startsWith("0.0.0.0") && !host.startsWith("[::]")) {
    return `${url.protocol}//${host}`;
  }
  if (process.env.HIVE_URL) return process.env.HIVE_URL.replace(/\/$/, "");
  if (url.hostname === "0.0.0.0" || url.hostname === "::") {
    url.hostname = "127.0.0.1";
  }
  return url.origin;
}

export async function handleMcpHttp(req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id") || crypto.randomUUID();
  const extra = { "Mcp-Session-Id": sessionId };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...MCP_CORS_HEADERS, ...extra } });
  }

  if (req.method === "DELETE") {
    return new Response(null, { status: 204, headers: { ...MCP_CORS_HEADERS, ...extra } });
  }

  if (req.method === "GET") {
    return jsonResponse(mcpServerCard(publicOrigin(req)), 200, extra);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405, extra);
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return jsonResponse(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      400,
      extra,
    );
  }

  const accept = req.headers.get("accept") || "";
  const preferSse = accept.includes("text/event-stream") && !accept.includes("application/json");
  const encode = (body: unknown, status = 200) =>
    preferSse ? sseResponse(body, extra) : jsonResponse(body, status, extra);

  if (Array.isArray(parsed)) {
    const responses = (parsed as JsonRpcRequest[])
      .map((msg) => handleJsonRpc(msg, req.headers))
      .filter((x): x is JsonRpcResponse => x !== null);
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: { ...MCP_CORS_HEADERS, ...extra } });
    }
    return encode(responses);
  }

  const message = parsed as JsonRpcRequest;
  if (message.id === undefined) {
    handleJsonRpc(message, req.headers);
    return new Response(null, { status: 202, headers: { ...MCP_CORS_HEADERS, ...extra } });
  }

  const response = handleJsonRpc(message, req.headers);
  return encode(response ?? { jsonrpc: "2.0", id: message.id ?? null, result: {} });
}
