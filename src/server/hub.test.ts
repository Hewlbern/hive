import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientToServer, Member, ServerToClient } from "@/lib/protocol";
import { getWallet, resetLedgerForTests, setWallet } from "./ledger-store";
import { getBuildingPublic, handleMessage, resetHubForTests, subscribe } from "./hub";

function joinMsg(id: string, extras: Partial<Member> = {}): ClientToServer {
  return {
    type: "join",
    code: "HIVE",
    member: {
      id,
      name: id,
      kind: extras.kind ?? "laptop",
      vramMB: extras.vramMB ?? 6000,
      webgpu: extras.webgpu ?? true,
      sharing: extras.sharing ?? false,
      safari: false,
    },
  };
}

function inbox(id: string) {
  const msgs: ServerToClient[] = [];
  const unsub = subscribe(id, (m) => msgs.push(m));
  return { msgs, unsub };
}

describe("presence join/leave", () => {
  beforeEach(() => {
    resetLedgerForTests();
    resetHubForTests();
  });
  afterEach(() => {
    resetHubForTests();
  });

  it("adds a member on join and removes them on leave", () => {
    const { unsub } = inbox("alice");
    handleMessage("alice", joinMsg("alice"));
    expect(getBuildingPublic("HIVE").members.map((m) => m.id)).toContain("alice");
    handleMessage("alice", { type: "leave" });
    expect(getBuildingPublic("HIVE").members.map((m) => m.id)).not.toContain("alice");
    unsub();
  });

  it("starts with a locked catalog until someone shares", () => {
    const { unsub } = inbox("alice");
    handleMessage("alice", joinMsg("alice", { sharing: false }));
    const pub = getBuildingPublic("HIVE");
    expect(pub.catalog.every((m) => !m.unlocked)).toBe(true);
    expect(pub.pool.sharing).toBe(0);
    unsub();
  });

  it("two devices see each other", () => {
    const a = inbox("a");
    const b = inbox("b");
    handleMessage("a", joinMsg("a"));
    handleMessage("b", joinMsg("b"));
    const ids = getBuildingPublic("HIVE").members.map((m) => m.id).sort();
    expect(ids).toEqual(["a", "b"]);
    expect(a.msgs.some((m) => m.type === "roster" && m.members.length === 2)).toBe(true);
    a.unsub();
    b.unsub();
  });
});

describe("share compute unlocks the catalog", () => {
  beforeEach(() => {
    resetLedgerForTests();
    resetHubForTests();
  });

  it("unlocks Nano and Hive 15 when a laptop shares", () => {
    const { msgs, unsub } = inbox("a");
    handleMessage("a", joinMsg("a"));
    handleMessage("a", { type: "share", sharing: true, vramMB: 6000, webgpu: true, kind: "laptop" });
    const pub = getBuildingPublic("HIVE");
    expect(pub.pool.sharing).toBe(1);
    expect(pub.catalog.find((m) => m.id === "hive-nano")?.unlocked).toBe(true);
    expect(pub.catalog.find((m) => m.id === "hive-15")?.unlocked).toBe(true);
    expect(msgs.some((m) => m.type === "roster" && m.catalog.some((c) => c.id === "hive-nano" && c.unlocked))).toBe(true);
    unsub();
  });

  it("locks again when the only contributor leaves", () => {
    const { unsub } = inbox("a");
    handleMessage("a", joinMsg("a"));
    handleMessage("a", { type: "share", sharing: true, vramMB: 6000, webgpu: true, kind: "laptop" });
    handleMessage("a", { type: "leave" });
    expect(getBuildingPublic("HIVE").catalog.every((m) => !m.unlocked)).toBe(true);
    unsub();
  });
});

describe("fallback when a device drops", () => {
  beforeEach(() => {
    resetLedgerForTests();
    resetHubForTests();
  });

  it("aborts generation when the only worker stops sharing", () => {
    const a = inbox("a");
    const b = inbox("b");
    handleMessage("a", joinMsg("a"));
    handleMessage("b", joinMsg("b"));
    handleMessage("a", { type: "share", sharing: true, vramMB: 6000, webgpu: true, kind: "laptop" });
    handleMessage("b", {
      type: "generate",
      request: {
        generationId: "gen-1",
        requesterId: "b",
        modelId: "hive-nano",
        prompt: "Once upon a time",
        maxTokens: 16,
        temperature: 0,
        assignments: [],
        payFromPool: false,
      },
    });
    expect(a.msgs.some((m) => m.type === "generate")).toBe(true);
    handleMessage("a", { type: "share", sharing: false, vramMB: 6000, webgpu: true, kind: "laptop" });
    expect(b.msgs.some((m) => m.type === "abort")).toBe(true);
    a.unsub();
    b.unsub();
  });

  it("falls back the selected model when pool shrinks below it", () => {
    const { unsub } = inbox("desk");
    handleMessage("desk", joinMsg("desk", { kind: "desktop", vramMB: 10000, sharing: true }));
    handleMessage("desk", { type: "select-model", modelId: "qwen25-7" });
    expect(getBuildingPublic("HIVE").pool.selectedModelId).toBe("qwen25-7");
    handleMessage("desk", { type: "share", sharing: true, vramMB: 400, webgpu: false, kind: "phone" });
    const pick = getBuildingPublic("HIVE");
    expect(pick.pool.activeModelId).toBe("hive-15");
    expect(pick.pool.warning).toMatch(/no longer fits|Fell back|locked|cannot run/i);
    unsub();
  });
});

describe("pay-as-you-generate", () => {
  beforeEach(() => {
    resetLedgerForTests();
    resetHubForTests();
  });

  it("pays the worker for a single completed token", () => {
    const a = inbox("worker");
    const b = inbox("buyer");
    handleMessage("worker", joinMsg("worker"));
    handleMessage("buyer", joinMsg("buyer"));
    handleMessage("worker", { type: "share", sharing: true, vramMB: 6000, webgpu: true, kind: "laptop" });
    const beforeWorker = getWallet("worker");
    handleMessage("buyer", {
      type: "generate",
      request: {
        generationId: "gen-one",
        requesterId: "buyer",
        modelId: "hive-nano",
        prompt: "hi",
        maxTokens: 8,
        temperature: 0,
        assignments: [],
        payFromPool: false,
      },
    });
    handleMessage("worker", {
      type: "token",
      event: { generationId: "gen-one", index: 0, token: "hello", done: true, tokPerSec: 4 },
    });
    expect(getWallet("worker")).toBeGreaterThan(beforeWorker);
    const pay = a.msgs.find((m) => m.type === "pay");
    expect(pay && pay.type === "pay" ? pay.event.earned.worker : 0).toBeGreaterThan(0);
    expect(b.msgs.some((m) => m.type === "token" && m.event.token === "hello")).toBe(true);
    a.unsub();
    b.unsub();
  });

  it("pays the worker and reserves the requester", () => {
    const a = inbox("worker");
    const b = inbox("buyer");
    handleMessage("worker", joinMsg("worker"));
    handleMessage("buyer", joinMsg("buyer"));
    handleMessage("worker", { type: "share", sharing: true, vramMB: 6000, webgpu: true, kind: "laptop" });
    const beforeBuyer = getWallet("buyer");
    const beforeWorker = getWallet("worker");
    handleMessage("buyer", {
      type: "generate",
      request: {
        generationId: "gen-pay",
        requesterId: "buyer",
        modelId: "hive-nano",
        prompt: "hi",
        maxTokens: 8,
        temperature: 0,
        assignments: [],
        payFromPool: false,
      },
    });
    expect(getWallet("buyer")).toBe(beforeBuyer - 8);
    handleMessage("worker", {
      type: "token",
      event: { generationId: "gen-pay", index: 0, token: "hello", done: false, tokPerSec: 4 },
    });
    expect(getWallet("worker")).toBeGreaterThan(beforeWorker);
    expect(b.msgs.some((m) => m.type === "token" && m.event.token === "hello")).toBe(true);
    expect(a.msgs.some((m) => m.type === "pay")).toBe(true);
    a.unsub();
    b.unsub();
  });

  it("pauses when the requester runs out of credits", () => {
    const a = inbox("worker");
    const b = inbox("broke");
    handleMessage("worker", joinMsg("worker"));
    handleMessage("broke", joinMsg("broke"));
    handleMessage("worker", { type: "share", sharing: true, vramMB: 6000, webgpu: true, kind: "laptop" });
    setWallet("broke", 2);
    handleMessage("broke", {
      type: "generate",
      request: {
        generationId: "gen-out",
        requesterId: "broke",
        modelId: "hive-nano",
        prompt: "hi",
        maxTokens: 8,
        temperature: 0,
        assignments: [],
        payFromPool: false,
      },
    });
    expect(b.msgs.filter((m) => m.type === "error").length).toBeGreaterThan(0);
    const err = b.msgs.find((m) => m.type === "error");
    expect(err && err.type === "error" ? err.message : "").toMatch(/credits/i);
    a.unsub();
    b.unsub();
  });

  it("stops mid-stream when reserved credits run out", () => {
    const a = inbox("worker");
    const b = inbox("buyer");
    handleMessage("worker", joinMsg("worker"));
    handleMessage("buyer", joinMsg("buyer"));
    handleMessage("worker", { type: "share", sharing: true, vramMB: 6000, webgpu: true, kind: "laptop" });
    setWallet("buyer", 8);
    handleMessage("buyer", {
      type: "generate",
      request: {
        generationId: "gen-mid",
        requesterId: "buyer",
        modelId: "hive-nano",
        prompt: "hi",
        maxTokens: 8,
        temperature: 0,
        assignments: [],
        payFromPool: false,
      },
    });
    expect(b.msgs.some((m) => m.type === "generate")).toBe(true);
    for (let i = 0; i < 8; i++) {
      handleMessage("worker", {
        type: "token",
        event: { generationId: "gen-mid", index: i, token: "x", done: false, tokPerSec: 1 },
      });
    }
    expect(b.msgs.some((m) => m.type === "abort" && /credit/i.test(m.reason))).toBe(true);
    a.unsub();
    b.unsub();
  });
});
