import { describe, expect, it } from "vitest";
import { guildToSwarmId, isDiscordSwarm, normalizeSwarmId } from "./swarm-id";

describe("swarm id", () => {
  it("keeps office codes short and uppercased", () => {
    expect(normalizeSwarmId("hive")).toBe("HIVE");
    expect(normalizeSwarmId("oaks!!")).toBe("OAKS");
  });

  it("maps Discord guilds to dc:<id>", () => {
    expect(guildToSwarmId("123456789012345678")).toBe("dc:123456789012345678");
    expect(normalizeSwarmId("dc:999")).toBe("dc:999");
    expect(normalizeSwarmId("DC_999")).toBe("dc:999");
    expect(isDiscordSwarm("dc:1")).toBe(true);
    expect(isDiscordSwarm("HIVE")).toBe(false);
  });
});
