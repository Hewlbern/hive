import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FriendsError } from "@/lib/friends";
import {
  acceptFriend,
  listFriendGraph,
  pullFriendShares,
  requestFriend,
  resetFriendsForTests,
  revokeFriend,
  shareWithFriend,
} from "./friends-store";

describe("friend model", () => {
  beforeEach(() => {
    process.env.HIVE_FRIENDS_PATH = "data/friends.test.json";
    resetFriendsForTests();
  });
  afterEach(() => {
    resetFriendsForTests();
  });

  it("requests, accepts, lists, and revokes a bidirectional friendship", () => {
    const pending = requestFriend("pod-a", "pod-b", "Alice");
    expect(pending.status).toBe("pending");
    expect(pending.requesterId).toBe("pod-a");
    expect(pending.peerId).toBe("pod-b");

    const graphB = listFriendGraph("pod-b");
    expect(graphB.friends).toEqual([]);
    expect(graphB.incoming.map((r) => r.peerId)).toEqual(["pod-a"]);
    expect(listFriendGraph("pod-a").outgoing.map((r) => r.peerId)).toEqual(["pod-b"]);

    const accepted = acceptFriend("pod-b", "pod-a");
    expect(accepted.status).toBe("accepted");
    expect(listFriendGraph("pod-a").friends.map((f) => f.peerId)).toEqual(["pod-b"]);
    expect(listFriendGraph("pod-b").friends.map((f) => f.peerId)).toEqual(["pod-a"]);

    revokeFriend("pod-a", "pod-b");
    expect(listFriendGraph("pod-a").friends).toEqual([]);
    expect(listFriendGraph("pod-b").friends).toEqual([]);
  });

  it("auto-accepts when the peer requests back", () => {
    requestFriend("aaa", "bbb");
    const back = requestFriend("bbb", "aaa");
    expect(back.status).toBe("accepted");
    expect(listFriendGraph("aaa").friends).toHaveLength(1);
  });

  it("is idempotent once already friends", () => {
    requestFriend("a", "b");
    acceptFriend("b", "a");
    const again = requestFriend("a", "b");
    expect(again.status).toBe("accepted");
    expect(acceptFriend("b", "a").status).toBe("accepted");
  });

  it("rejects friending yourself", () => {
    expect(() => requestFriend("same", "same")).toThrow(FriendsError);
  });

  it("does not let the requester accept their own outgoing request", () => {
    requestFriend("a", "b");
    expect(() => acceptFriend("a", "b")).toThrow(/recipient/);
  });
});

describe("opt-in shares", () => {
  beforeEach(() => {
    process.env.HIVE_FRIENDS_PATH = "data/friends.test.json";
    resetFriendsForTests();
    requestFriend("alpha", "bravo");
    acceptFriend("bravo", "alpha");
  });
  afterEach(() => {
    resetFriendsForTests();
  });

  it("denies share and pull until friendship is accepted", () => {
    requestFriend("alpha", "charlie");
    expect(() =>
      shareWithFriend("alpha", "charlie", { body: "secret" }),
    ).toThrow(/default deny/);
    expect(pullFriendShares("charlie")).toEqual([]);
  });

  it("shares only the explicit body and pulls only inbound opt-in payloads", () => {
    const share = shareWithFriend("alpha", "bravo", {
      body: "layer split is 0-8 on this laptop",
      scope: "fact",
      label: "assignment",
    });
    expect(share.body).toBe("layer split is 0-8 on this laptop");
    expect(share.scope).toBe("fact");

    expect(pullFriendShares("bravo").map((s) => s.body)).toEqual([
      "layer split is 0-8 on this laptop",
    ]);
    // Sharer does not see it as inbound.
    expect(pullFriendShares("alpha")).toEqual([]);
    // A third pod sees nothing.
    expect(pullFriendShares("charlie")).toEqual([]);
  });

  it("rejects an empty body so there is no silent dump", () => {
    expect(() => shareWithFriend("alpha", "bravo", { body: "   " })).toThrow(/never dumps/);
  });

  it("filters by scope and label", () => {
    shareWithFriend("alpha", "bravo", { body: "one", scope: "note", label: "standup" });
    shareWithFriend("alpha", "bravo", { body: "two", scope: "context", label: "build" });
    expect(pullFriendShares("bravo", { scope: "note" })).toHaveLength(1);
    expect(pullFriendShares("bravo", { label: "build" }).map((s) => s.body)).toEqual(["two"]);
  });

  it("hides expired shares", () => {
    shareWithFriend("alpha", "bravo", { body: "ephemeral", ttlSeconds: 1 });
    const realNow = Date.now;
    Date.now = () => realNow() + 2000;
    try {
      expect(pullFriendShares("bravo")).toEqual([]);
    } finally {
      Date.now = realNow;
    }
  });

  it("drops shares on revoke and does not restore them after re-friend", () => {
    shareWithFriend("alpha", "bravo", { body: "old fact" });
    revokeFriend("bravo", "alpha");
    expect(pullFriendShares("bravo")).toEqual([]);
    requestFriend("alpha", "bravo");
    acceptFriend("bravo", "alpha");
    expect(pullFriendShares("bravo")).toEqual([]);
  });
});
