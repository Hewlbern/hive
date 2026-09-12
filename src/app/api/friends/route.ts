import { FriendsError } from "@/lib/friends";
import {
  acceptFriend,
  listFriendGraph,
  pullFriendShares,
  requestFriend,
  revokeFriend,
  shareWithFriend,
} from "@/server/friends-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown, fallback = 400) {
  if (err instanceof FriendsError) {
    const status =
      err.code === "not_found" ? 404 : err.code === "not_friends" ? 403 : fallback;
    return Response.json({ error: err.code, message: err.message }, { status });
  }
  const message = err instanceof Error ? err.message : "bad request";
  return Response.json({ error: message }, { status: fallback });
}

/** List friends + pending, or inbound shares (`view=shares`). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const podId = url.searchParams.get("podId");
  if (!podId) return Response.json({ error: "podId required" }, { status: 400 });
  try {
    if (url.searchParams.get("view") === "shares") {
      const shares = pullFriendShares(podId, {
        fromId: url.searchParams.get("fromId") ?? undefined,
        scope: url.searchParams.get("scope") ?? undefined,
        label: url.searchParams.get("label") ?? undefined,
      });
      return Response.json({ ok: true, podId, shares });
    }
    return Response.json({ ok: true, ...listFriendGraph(podId) });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Same store the MCP tools wrap. Ops: request | accept | revoke | share | pull.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const op = String(body.op ?? "");
  const podId = String(body.podId ?? "");
  const peerId = String(body.peerId ?? body.fromId ?? "");
  try {
    if (op === "request") {
      return Response.json({
        ok: true,
        friendship: requestFriend(podId, peerId, typeof body.name === "string" ? body.name : undefined),
      });
    }
    if (op === "accept") {
      return Response.json({ ok: true, friendship: acceptFriend(podId, peerId) });
    }
    if (op === "revoke") {
      return Response.json({ ok: true, friendship: revokeFriend(podId, peerId) });
    }
    if (op === "share") {
      return Response.json({
        ok: true,
        share: shareWithFriend(podId, peerId, {
          body: String(body.body ?? ""),
          scope: typeof body.scope === "string" ? body.scope : undefined,
          label: typeof body.label === "string" ? body.label : undefined,
          ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined,
        }),
      });
    }
    if (op === "pull") {
      return Response.json({
        ok: true,
        podId,
        shares: pullFriendShares(podId, {
          fromId: typeof body.fromId === "string" ? body.fromId : undefined,
          scope: typeof body.scope === "string" ? body.scope : undefined,
          label: typeof body.label === "string" ? body.label : undefined,
        }),
      });
    }
    return Response.json(
      { error: "op must be request, accept, revoke, share, or pull" },
      { status: 400 },
    );
  } catch (err) {
    return fail(err);
  }
}
