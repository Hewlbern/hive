import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG,
  buildCatalog,
  catalogHeadline,
  largestUnlockedLive,
  modelFits,
  pickRunnableModel,
  pooledMB,
} from "./models";
import type { Member } from "./protocol";

function member(partial: Partial<Member> & { id: string; vramMB: number; sharing?: boolean }): Member {
  return {
    name: partial.id,
    kind: "laptop",
    webgpu: true,
    sharing: partial.sharing ?? true,
    online: true,
    layers: null,
    tokPerSec: 0,
    earnedSession: 0,
    spentSession: 0,
    quality: "good",
    busy: false,
    safari: false,
    ...partial,
  };
}

describe("catalog unlock", () => {
  it("locks everything when nobody is sharing", () => {
    const members = [member({ id: "a", vramMB: 6000, sharing: false })];
    expect(pooledMB(members)).toBe(0);
    const cat = buildCatalog(members);
    expect(cat.every((m) => !m.unlocked)).toBe(true);
    expect(largestUnlockedLive(members)).toBeNull();
  });

  it("unlocks Nano on a single phone", () => {
    const members = [member({ id: "phone", vramMB: 900, kind: "phone" })];
    const cat = buildCatalog(members);
    expect(cat.find((m) => m.id === "hive-nano")?.unlocked).toBe(true);
    expect(cat.find((m) => m.id === "qwen25-05")?.unlocked).toBe(false);
    expect(cat.find((m) => m.id === "qwen25-05")?.hint).toMatch(/laptop/i);
    expect(largestUnlockedLive(members)?.id).toBe("hive-15");
  });

  it("unlocks Qwen 0.5B when a WebGPU laptop shares", () => {
    const members = [member({ id: "laptop", vramMB: 6000 })];
    expect(modelFits(MODEL_CATALOG.find((m) => m.id === "qwen25-05")!, members)).toBe(true);
    expect(buildCatalog(members).find((m) => m.id === "qwen25-7")?.unlocked).toBe(true);
    expect(buildCatalog(members).find((m) => m.id === "qwen3-27")?.unlocked).toBe(false);
  });

  it("does not unlock WebLLM models without WebGPU even if VRAM is high", () => {
    const members = [member({ id: "x", vramMB: 8000, webgpu: false })];
    expect(buildCatalog(members).find((m) => m.id === "qwen25-05")?.unlocked).toBe(false);
    expect(buildCatalog(members).find((m) => m.id === "hive-nano")?.unlocked).toBe(true);
  });

  it("falls back when the selected model no longer fits", () => {
    const onePhone = [member({ id: "p", vramMB: 900, kind: "phone" })];
    const pick = pickRunnableModel("qwen25-7", onePhone);
    expect(pick.model?.id).toBe("hive-15");
    expect(pick.warning).toMatch(/no longer fits|Fell back/i);
  });

  it("warns when a protocol-only 27B is unlocked but not live", () => {
    const office = [
      member({ id: "d1", vramMB: 10000, kind: "desktop" }),
      member({ id: "d2", vramMB: 10000, kind: "desktop" }),
    ];
    expect(buildCatalog(office).find((m) => m.id === "qwen3-27")?.unlocked).toBe(true);
    const pick = pickRunnableModel("qwen3-27", office);
    expect(pick.model?.live).toBe(true);
    expect(pick.warning).toMatch(/not shipped|ready/i);
  });

  it("writes a live headline the room can show", () => {
    const members = [member({ id: "a", vramMB: 6000 }), member({ id: "b", vramMB: 6000 })];
    const line = catalogHeadline(members);
    expect(line).toMatch(/2 devices/);
    expect(line).toMatch(/unlocked/);
  });

  it("locks a previously unlocked 7B when the pool shrinks to a phone", () => {
    const office = [
      member({ id: "d1", vramMB: 10000, kind: "desktop" }),
      member({ id: "d2", vramMB: 10000, kind: "desktop" }),
    ];
    expect(buildCatalog(office).find((m) => m.id === "qwen25-7")?.unlocked).toBe(true);
    const phoneOnly = [member({ id: "p", vramMB: 900, kind: "phone" })];
    expect(buildCatalog(phoneOnly).find((m) => m.id === "qwen25-7")?.unlocked).toBe(false);
    const pick = pickRunnableModel("qwen25-7", phoneOnly);
    expect(pick.model?.id).not.toBe("qwen25-7");
    expect(pick.warning).toMatch(/no longer fits|Fell back/i);
  });
});

