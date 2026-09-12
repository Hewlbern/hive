/**
 * Friend / trusted-peer types.
 *
 * Identity is the existing Hive device id (`hive.deviceId` in the browser,
 * `~/.config/hive/device_id` on desktop). Do not invent a second id space.
 *
 * Privacy: friendship is bidirectional only after accept. Shares are addressed
 * payloads the sender opts into — never an ambient dump of roster, wallet,
 * prompts, or activations.
 */

export const SHARE_SCOPES = ["note", "fact", "context"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export type FriendshipStatus = "pending" | "accepted" | "revoked";

export type Friendship = {
  id: string;
  requesterId: string;
  peerId: string;
  status: FriendshipStatus;
  createdAt: number;
  acceptedAt?: number;
  revokedAt?: number;
  requesterName?: string;
};

export type FriendShare = {
  id: string;
  fromId: string;
  toId: string;
  body: string;
  scope: ShareScope;
  label?: string;
  createdAt: number;
  expiresAt?: number;
};

export type FriendView = {
  peerId: string;
  status: "accepted";
  since: number;
  requesterName?: string;
};

export type PendingView = {
  peerId: string;
  direction: "incoming" | "outgoing";
  createdAt: number;
  requesterName?: string;
};

export type FriendGraph = {
  podId: string;
  friends: FriendView[];
  incoming: PendingView[];
  outgoing: PendingView[];
};

export const DEFAULT_SHARE_SCOPE: ShareScope = "note";
export const MAX_SHARE_BODY_CHARS = 8000;
export const MAX_SHARE_LABEL_CHARS = 64;
export const MAX_POD_ID_CHARS = 128;
export const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

export function normalizePodId(raw: string | undefined | null): string {
  const id = String(raw ?? "").trim().toLowerCase();
  if (!id || id.length > MAX_POD_ID_CHARS) {
    throw new FriendsError(
      "invalid_pod",
      "pod id required (Hive device id). Pass podId, or set X-Hive-Pod-Id / HIVE_POD_ID.",
    );
  }
  return id;
}

export function isShareScope(value: unknown): value is ShareScope {
  return typeof value === "string" && (SHARE_SCOPES as readonly string[]).includes(value);
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function otherPod(friendship: Friendship, podId: string): string {
  return friendship.requesterId === podId ? friendship.peerId : friendship.requesterId;
}

export class FriendsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FriendsError";
    this.code = code;
  }
}
