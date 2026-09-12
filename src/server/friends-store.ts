import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SHARE_SCOPE,
  FriendsError,
  MAX_SHARE_BODY_CHARS,
  MAX_SHARE_LABEL_CHARS,
  MAX_TTL_SECONDS,
  type FriendGraph,
  type FriendShare,
  type Friendship,
  type PendingView,
  type ShareScope,
  isShareScope,
  normalizePodId,
  otherPod,
  pairKey,
} from "@/lib/friends";

type State = {
  friendships: Record<string, Friendship>;
  shares: Record<string, FriendShare>;
};

function dataPath(): string {
  return process.env.HIVE_FRIENDS_PATH || join(process.cwd(), "data", "friends.json");
}

function empty(): State {
  return { friendships: {}, shares: {} };
}

function load(): State {
  try {
    const raw = readFileSync(/* turbopackIgnore: true */ dataPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      friendships: parsed.friendships ?? {},
      shares: parsed.shares ?? {},
    };
  } catch {
    return empty();
  }
}

let state = load();

function persist() {
  try {
    const path = dataPath();
    mkdirSync(/* turbopackIgnore: true */ dirname(path), { recursive: true });
    writeFileSync(/* turbopackIgnore: true */ path, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn("[hive] friends persist failed", err);
  }
}

function now(): number {
  return Date.now();
}

function getPair(a: string, b: string): Friendship | undefined {
  return state.friendships[pairKey(a, b)];
}

function isAcceptedFriends(a: string, b: string): boolean {
  const row = getPair(a, b);
  return Boolean(row && row.status === "accepted");
}

function dropSharesBetween(a: string, b: string) {
  for (const [id, share] of Object.entries(state.shares)) {
    const pair = pairKey(share.fromId, share.toId);
    if (pair === pairKey(a, b)) delete state.shares[id];
  }
}

export function requestFriend(
  requesterIdRaw: string,
  peerIdRaw: string,
  requesterName?: string,
): Friendship {
  const requesterId = normalizePodId(requesterIdRaw);
  const peerId = normalizePodId(peerIdRaw);
  if (requesterId === peerId) {
    throw new FriendsError("self", "cannot friend your own pod");
  }

  const key = pairKey(requesterId, peerId);
  const existing = state.friendships[key];
  const name = requesterName?.trim().slice(0, 64) || undefined;

  if (existing?.status === "accepted") {
    return existing;
  }

  if (existing?.status === "pending") {
    if (existing.peerId === requesterId && existing.requesterId === peerId) {
      existing.status = "accepted";
      existing.acceptedAt = now();
      persist();
      return existing;
    }
    return existing;
  }

  const row: Friendship = {
    id: existing?.id ?? randomUUID(),
    requesterId,
    peerId,
    status: "pending",
    createdAt: now(),
    requesterName: name ?? existing?.requesterName,
  };
  delete row.acceptedAt;
  delete row.revokedAt;
  state.friendships[key] = row;
  persist();
  return row;
}

export function acceptFriend(podIdRaw: string, peerIdRaw: string): Friendship {
  const podId = normalizePodId(podIdRaw);
  const peerId = normalizePodId(peerIdRaw);
  const existing = getPair(podId, peerId);
  if (!existing || existing.status === "revoked") {
    throw new FriendsError("not_found", "no pending friend request from that pod");
  }
  if (existing.status === "accepted") {
    return existing;
  }
  if (existing.peerId !== podId) {
    throw new FriendsError(
      "not_pending",
      "only the recipient can accept a friend request",
    );
  }
  existing.status = "accepted";
  existing.acceptedAt = now();
  persist();
  return existing;
}

export function revokeFriend(podIdRaw: string, peerIdRaw: string): Friendship {
  const podId = normalizePodId(podIdRaw);
  const peerId = normalizePodId(peerIdRaw);
  const existing = getPair(podId, peerId);
  if (!existing || existing.status === "revoked") {
    throw new FriendsError("not_found", "no friendship or pending request with that pod");
  }
  if (existing.requesterId !== podId && existing.peerId !== podId) {
    throw new FriendsError("not_found", "no friendship or pending request with that pod");
  }
  existing.status = "revoked";
  existing.revokedAt = now();
  dropSharesBetween(podId, peerId);
  persist();
  return existing;
}

export function listFriendGraph(podIdRaw: string): FriendGraph {
  const podId = normalizePodId(podIdRaw);
  const friends: FriendGraph["friends"] = [];
  const incoming: PendingView[] = [];
  const outgoing: PendingView[] = [];

  for (const row of Object.values(state.friendships)) {
    if (row.requesterId !== podId && row.peerId !== podId) continue;
    if (row.status === "revoked") continue;
    const peerId = otherPod(row, podId);
    if (row.status === "accepted") {
      friends.push({
        peerId,
        status: "accepted",
        since: row.acceptedAt ?? row.createdAt,
        requesterName: row.requesterName,
      });
    } else if (row.peerId === podId) {
      incoming.push({
        peerId,
        direction: "incoming",
        createdAt: row.createdAt,
        requesterName: row.requesterName,
      });
    } else {
      outgoing.push({
        peerId,
        direction: "outgoing",
        createdAt: row.createdAt,
        requesterName: row.requesterName,
      });
    }
  }

  friends.sort((a, b) => a.peerId.localeCompare(b.peerId));
  incoming.sort((a, b) => a.peerId.localeCompare(b.peerId));
  outgoing.sort((a, b) => a.peerId.localeCompare(b.peerId));
  return { podId, friends, incoming, outgoing };
}

export type ShareInput = {
  body: string;
  scope?: string;
  label?: string;
  ttlSeconds?: number;
};

export function shareWithFriend(
  fromIdRaw: string,
  toIdRaw: string,
  input: ShareInput,
): FriendShare {
  const fromId = normalizePodId(fromIdRaw);
  const toId = normalizePodId(toIdRaw);
  if (fromId === toId) {
    throw new FriendsError("self", "cannot share with your own pod");
  }
  if (!isAcceptedFriends(fromId, toId)) {
    throw new FriendsError(
      "not_friends",
      "not friends: default deny. Send hive_friend_request and wait for accept before sharing.",
    );
  }

  const body = String(input.body ?? "").trim();
  if (!body) {
    throw new FriendsError(
      "empty_share",
      "share body required — Hive never dumps ambient context. Pass the exact note/fact/context the operator opted into.",
    );
  }
  if (body.length > MAX_SHARE_BODY_CHARS) {
    throw new FriendsError(
      "share_too_large",
      `share body exceeds ${MAX_SHARE_BODY_CHARS} characters`,
    );
  }

  const scope: ShareScope = input.scope ? (input.scope as ShareScope) : DEFAULT_SHARE_SCOPE;
  if (!isShareScope(scope)) {
    throw new FriendsError(
      "invalid_scope",
      `scope must be one of: note, fact, context (got ${String(input.scope)})`,
    );
  }

  let label = input.label?.trim();
  if (label) {
    label = label.replace(/\s+/g, " ").slice(0, MAX_SHARE_LABEL_CHARS);
  } else {
    label = undefined;
  }

  let expiresAt: number | undefined;
  if (input.ttlSeconds !== undefined && input.ttlSeconds !== null) {
    const ttl = Number(input.ttlSeconds);
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) {
      throw new FriendsError(
        "invalid_ttl",
        `ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}`,
      );
    }
    expiresAt = now() + Math.floor(ttl * 1000);
  }

  const share: FriendShare = {
    id: randomUUID(),
    fromId,
    toId,
    body,
    scope,
    label,
    createdAt: now(),
    expiresAt,
  };
  state.shares[share.id] = share;
  persist();
  return share;
}

export type PullFilter = {
  fromId?: string;
  scope?: string;
  label?: string;
};

export function pullFriendShares(podIdRaw: string, filter: PullFilter = {}): FriendShare[] {
  const podId = normalizePodId(podIdRaw);
  const fromId = filter.fromId ? normalizePodId(filter.fromId) : undefined;
  if (filter.scope && !isShareScope(filter.scope)) {
    throw new FriendsError("invalid_scope", "scope must be one of: note, fact, context");
  }
  const label = filter.label?.trim();
  const t = now();

  const out: FriendShare[] = [];
  for (const share of Object.values(state.shares)) {
    if (share.toId !== podId) continue;
    if (fromId && share.fromId !== fromId) continue;
    if (filter.scope && share.scope !== filter.scope) continue;
    if (label && share.label !== label) continue;
    if (share.expiresAt !== undefined && share.expiresAt <= t) continue;
    if (!isAcceptedFriends(podId, share.fromId)) continue;
    out.push(share);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export function resetFriendsForTests() {
  state = empty();
  persist();
}
