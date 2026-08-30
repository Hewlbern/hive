import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearBinding,
  consumePairingCode,
  getBinding,
  registerPairingCode,
  resetPairingForTests,
} from "./pairing-store";

describe("pairing codes", () => {
  beforeEach(() => {
    process.env.HIVE_PAIRING_PATH = "data/pairing.test.json";
    resetPairingForTests();
  });
  afterEach(() => {
    resetPairingForTests();
  });

  it("registers and consumes a code once", () => {
    registerPairingCode("ab12cd", "device-1");
    const first = consumePairingCode("AB12CD", "user-9", "guild-1");
    expect(first?.deviceId).toBe("device-1");
    expect(getBinding("guild-1", "user-9")?.deviceId).toBe("device-1");
    const second = consumePairingCode("AB12CD", "user-9", "guild-1");
    expect(second).toBeNull();
  });

  it("clears a binding on unshare", () => {
    registerPairingCode("ZZZZZZ", "dev");
    consumePairingCode("ZZZZZZ", "u", "g");
    expect(clearBinding("g", "u")).toBe(true);
    expect(getBinding("g", "u")).toBeNull();
  });
});
