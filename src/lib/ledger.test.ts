import { describe, expect, it } from "vitest";
import {
  applyTokenSettlement,
  releaseUnused,
  reserveForPrompt,
  splitTokenCredits,
} from "./ledger";

describe("splitTokenCredits", () => {
  it("gives the only worker the whole token", () => {
    const s = splitTokenCredits([{ deviceId: "a", start: 0, end: 5 }], 5, 1);
    expect(s).toEqual([{ deviceId: "a", credits: 1 }]);
  });

  it("splits 1 credit by layer count without losing remainder", () => {
    const s = splitTokenCredits(
      [
        { deviceId: "laptop", start: 0, end: 4 },
        { deviceId: "phone", start: 4, end: 6 },
      ],
      6,
      1,
    );
    const total = s.reduce((n, x) => n + x.credits, 0);
    expect(total).toBeCloseTo(1, 5);
    const laptop = s.find((x) => x.deviceId === "laptop")!;
    const phone = s.find((x) => x.deviceId === "phone")!;
    expect(laptop.credits).toBeGreaterThan(phone.credits);
  });

  it("pays three devices that each held layers", () => {
    const s = splitTokenCredits(
      [
        { deviceId: "a", start: 0, end: 3 },
        { deviceId: "b", start: 3, end: 5 },
        { deviceId: "c", start: 5, end: 6 },
      ],
      6,
      1,
    );
    expect(s).toHaveLength(3);
    expect(s.reduce((n, x) => n + x.credits, 0)).toBeCloseTo(1, 5);
  });
});

describe("reserveForPrompt", () => {
  it("debits the personal wallet when it covers the reserve", () => {
    const r = reserveForPrompt(400, 5000, 64, true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("wallet");
      expect(r.walletAfter).toBe(336);
      expect(r.poolAfter).toBe(5000);
    }
  });

  it("falls through to the office pool", () => {
    const r = reserveForPrompt(10, 200, 64, true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("pool");
      expect(r.walletAfter).toBe(0);
      expect(r.poolAfter).toBe(146);
    }
  });

  it("refuses when neither wallet nor pool can cover it", () => {
    const r = reserveForPrompt(3, 4, 64, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.needed).toBe(64);
  });

  it("can ignore the pool", () => {
    const r = reserveForPrompt(10, 5000, 64, false);
    expect(r.ok).toBe(false);
  });
});

describe("settlement", () => {
  it("releases unused reserve after a short generation", () => {
    expect(releaseUnused(64, 10)).toBe(54);
  });

  it("credits workers and consumes reserved funds per token", () => {
    const next = applyTokenSettlement({
      reservedLeft: 64,
      assignments: [
        { deviceId: "w", start: 0, end: 5 },
      ],
      nLayers: 5,
      requesterId: "r",
      balances: { r: 0, w: 10 },
      poolBalance: 100,
      source: "wallet",
    });
    expect(next.reservedLeft).toBe(63);
    expect(next.balances.w).toBe(11);
    expect(next.requesterDebit).toBe(1);
  });
});
