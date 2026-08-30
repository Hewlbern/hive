import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_STARTER_CREDITS } from "@/lib/protocol";
import {
  creditWallet,
  getHistory,
  getWallet,
  pushHistory,
  resetLedgerForTests,
} from "./ledger-store";
import { getBuildingPublic, handleMessage, resetHubForTests, subscribe } from "./hub";

describe("functional flows", () => {
  beforeEach(() => {
    resetLedgerForTests();
    resetHubForTests();
  });

  it("creates a new group that is empty and locked", () => {
    const pub = getBuildingPublic("OAKS");
    expect(pub.code).toBe("OAKS");
    expect(pub.members).toHaveLength(0);
    expect(pub.catalog.every((m) => !m.unlocked)).toBe(true);
  });

  it("join → share → catalog updates without a reload", () => {
    subscribe("phone", () => undefined);
    handleMessage("phone", {
      type: "join",
      code: "HIVE",
      member: {
        id: "phone",
        name: "pixel",
        kind: "phone",
        vramMB: 900,
        webgpu: true,
        sharing: false,
        safari: false,
      },
    });
    expect(getBuildingPublic("HIVE").catalog.find((m) => m.id === "hive-nano")?.unlocked).toBe(false);
    handleMessage("phone", { type: "share", sharing: true, vramMB: 900, webgpu: true, kind: "phone" });
    const after = getBuildingPublic("HIVE");
    expect(after.catalog.find((m) => m.id === "hive-nano")?.unlocked).toBe(true);
    expect(after.catalog.find((m) => m.id === "qwen25-7")?.unlocked).toBe(false);
    expect(after.pool.pooledMB).toBe(900);
  });

  it("demo top-up credits the wallet immediately", () => {
    expect(getWallet("dev-1")).toBe(DEMO_STARTER_CREDITS);
    creditWallet("dev-1", 500);
    pushHistory("dev-1", {
      id: "t1",
      at: Date.now(),
      credits: 500,
      usd: 5,
      rail: "demo",
      note: "Demo top-up +500",
    });
    expect(getWallet("dev-1")).toBe(DEMO_STARTER_CREDITS + 500);
    expect(getHistory("dev-1")[0]?.credits).toBe(500);
  });

  it("streams tokens to every peer in the group", () => {
    const seen: Record<string, string[]> = { w: [], r: [] };
    subscribe("w", (m) => {
      if (m.type === "token" && m.event.token) seen.w.push(m.event.token);
    });
    subscribe("r", (m) => {
      if (m.type === "token" && m.event.token) seen.r.push(m.event.token);
    });
    handleMessage("w", {
      type: "join",
      code: "HIVE",
      member: { id: "w", name: "w", kind: "laptop", vramMB: 4000, webgpu: true, sharing: true, safari: false },
    });
    handleMessage("r", {
      type: "join",
      code: "HIVE",
      member: { id: "r", name: "r", kind: "phone", vramMB: 200, webgpu: false, sharing: false, safari: false },
    });
    handleMessage("r", {
      type: "generate",
      request: {
        generationId: "g1",
        requesterId: "r",
        modelId: "hive-nano",
        prompt: "Once upon a time",
        maxTokens: 4,
        temperature: 0,
        assignments: [],
        payFromPool: true,
      },
    });
    handleMessage("w", {
      type: "token",
      event: { generationId: "g1", index: 0, token: " there", done: false, tokPerSec: 8 },
    });
    handleMessage("w", {
      type: "token",
      event: { generationId: "g1", index: 1, token: " was", done: true, tokPerSec: 8 },
    });
    expect(seen.w.join("")).toBe(" there was");
    expect(seen.r.join("")).toBe(" there was");
  });
});
