import { describe, expect, it } from "vitest";
import { assignLayers, assignSingleDevice, layerShare } from "./assign";

describe("assignLayers", () => {
  it("gives a single device every layer", () => {
    const a = assignLayers([{ id: "laptop", vramMB: 6000 }], 24);
    expect(a).toEqual([{ deviceId: "laptop", start: 0, end: 24 }]);
  });

  it("splits two equal devices into contiguous halves", () => {
    const a = assignLayers(
      [
        { id: "a", vramMB: 4000 },
        { id: "b", vramMB: 4000 },
      ],
      8,
    );
    expect(a).toHaveLength(2);
    const spans = a.map((x) => x.end - x.start).sort();
    expect(spans).toEqual([4, 4]);
    expect(a[0].start).toBe(0);
    expect(a[a.length - 1].end).toBe(8);
    // no overlap, no gaps
    const covered = new Set<number>();
    for (const block of a) {
      for (let i = block.start; i < block.end; i++) {
        expect(covered.has(i)).toBe(false);
        covered.add(i);
      }
    }
    expect(covered.size).toBe(8);
  });

  it("gives a laptop more layers than a phone", () => {
    const a = assignLayers(
      [
        { id: "phone", vramMB: 900 },
        { id: "laptop", vramMB: 6000 },
      ],
      6,
    );
    const phone = a.find((x) => x.deviceId === "phone")!;
    const laptop = a.find((x) => x.deviceId === "laptop")!;
    expect(laptop.end - laptop.start).toBeGreaterThan(phone.end - phone.start);
    expect(laptop.start).toBe(0);
    expect(a.reduce((s, x) => s + (x.end - x.start), 0)).toBe(6);
  });

  it("drops the weakest devices when there are more workers than layers", () => {
    const a = assignLayers(
      [
        { id: "d1", vramMB: 8000 },
        { id: "d2", vramMB: 4000 },
        { id: "d3", vramMB: 2000 },
        { id: "d4", vramMB: 200 },
        { id: "d5", vramMB: 100 },
      ],
      3,
    );
    expect(a).toHaveLength(3);
    expect(a.map((x) => x.deviceId)).not.toContain("d5");
    expect(a.reduce((s, x) => s + (x.end - x.start), 0)).toBe(3);
    for (const block of a) expect(block.end - block.start).toBeGreaterThanOrEqual(1);
  });

  it("returns empty when nobody has memory", () => {
    expect(assignLayers([{ id: "x", vramMB: 0 }], 8)).toEqual([]);
    expect(assignLayers([], 8)).toEqual([]);
  });

  it("computes layer share", () => {
    expect(layerShare({ deviceId: "a", start: 0, end: 4 }, 8)).toBe(0.5);
  });
});

describe("assignSingleDevice", () => {
  it("puts every layer on the strongest WebGPU fit", () => {
    const a = assignSingleDevice(
      [
        { id: "phone", vramMB: 1800, webgpu: true },
        { id: "laptop", vramMB: 6000, webgpu: true },
        { id: "cpu", vramMB: 8000, webgpu: false },
      ],
      24,
      950,
      true,
    );
    expect(a).toEqual([{ deviceId: "laptop", start: 0, end: 24 }]);
  });
});
