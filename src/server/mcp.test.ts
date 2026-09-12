import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetFriendsForTests } from "./friends-store";
import {
  MCP_TOOLS,
  callHiveTool,
  handleJsonRpc,
  handleMcpHttp,
  mcpServerCard,
} from "./mcp";

function textPayload(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("MCP friend tools", () => {
  beforeEach(() => {
    process.env.HIVE_FRIENDS_PATH = "data/friends.test.json";
    delete process.env.HIVE_POD_ID;
    resetFriendsForTests();
  });
  afterEach(() => {
    resetFriendsForTests();
    delete process.env.HIVE_POD_ID;
  });

  it("lists only the friend tools (no ambient dump tool)", () => {
    const names = MCP_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "hive_friend_accept",
        "hive_friend_request",
        "hive_friend_revoke",
        "hive_list_friends",
        "hive_pull_friend_shares",
        "hive_share_with_friend",
        "hive_whoami",
      ].sort(),
    );
    expect(names.some((n) => /dump|context_all|roster|wallet/i.test(n))).toBe(false);
    const share = MCP_TOOLS.find((t) => t.name === "hive_share_with_friend");
    expect(share?.description).toMatch(/Never attach/i);
  });

  it("initialize + tools/list + resources/list", () => {
    const init = handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test" } },
    });
    expect(init?.result).toMatchObject({
      protocolVersion: "2025-03-26",
      serverInfo: { name: "hive" },
    });
    const listed = handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (listed?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain("hive_share_with_friend");
    const resources = handleJsonRpc({ jsonrpc: "2.0", id: 3, method: "resources/list" });
    expect((resources?.result as { resources: { uri: string }[] }).resources.map((r) => r.uri)).toEqual(
      ["hive://whoami", "hive://friends", "hive://shares"],
    );
  });

  it("whoami from header and Grok-style end-to-end share", () => {
    const headers = { "x-hive-pod-id": "bot-a" };
    const me = textPayload(callHiveTool("hive_whoami", {}, headers));
    expect(me.podId).toBe("bot-a");

    const req = textPayload(
      callHiveTool("hive_friend_request", { peerId: "bot-b", name: "Grok A" }, headers),
    );
    expect((req.friendship as { status: string }).status).toBe("pending");

    const denied = callHiveTool(
      "hive_share_with_friend",
      { peerId: "bot-b", body: "should fail" },
      headers,
    );
    expect(denied.isError).toBe(true);
    expect(textPayload(denied).message).toMatch(/default deny/);

    const accepted = textPayload(
      callHiveTool("hive_friend_accept", { peerId: "bot-a" }, { "x-hive-pod-id": "bot-b" }),
    );
    expect((accepted.friendship as { status: string }).status).toBe("accepted");

    const shared = textPayload(
      callHiveTool(
        "hive_share_with_friend",
        { peerId: "bot-b", body: "pooled 12GB, Nano unlocked", scope: "fact", label: "pool" },
        headers,
      ),
    );
    expect((shared.share as { body: string }).body).toBe("pooled 12GB, Nano unlocked");

    const pulled = textPayload(
      callHiveTool("hive_pull_friend_shares", { fromId: "bot-a" }, { "x-hive-pod-id": "bot-b" }),
    );
    expect((pulled.shares as { body: string }[]).map((s) => s.body)).toEqual([
      "pooled 12GB, Nano unlocked",
    ]);

    const empty = textPayload(
      callHiveTool("hive_pull_friend_shares", {}, { "x-hive-pod-id": "bot-c" }),
    );
    expect(empty.shares).toEqual([]);

    callHiveTool("hive_friend_revoke", { peerId: "bot-b" }, headers);
    const after = textPayload(
      callHiveTool("hive_pull_friend_shares", {}, { "x-hive-pod-id": "bot-b" }),
    );
    expect(after.shares).toEqual([]);
  });

  it("prefers tool podId over env so two Grok Bots can share one hub", () => {
    process.env.HIVE_POD_ID = "env-pod";
    const me = textPayload(callHiveTool("hive_whoami", { podId: "override-pod" }));
    expect(me.podId).toBe("override-pod");
  });

  it("handleMcpHttp speaks Streamable HTTP JSON-RPC", async () => {
    const req = new Request("http://127.0.0.1/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-hive-pod-id": "http-pod",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "hive_whoami", arguments: {} },
      }),
    });
    const res = await handleMcpHttp(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(JSON.parse(json.result.content[0].text).podId).toBe("http-pod");
  });

  it("GET returns a server card Grok operators can probe", async () => {
    const res = await handleMcpHttp(new Request("http://127.0.0.1/api/mcp", { method: "GET" }));
    const card = (await res.json()) as { name: string; privacy: { ambientDump: boolean } };
    expect(card.name).toBe("hive");
    expect(card.privacy.ambientDump).toBe(false);
    expect(mcpServerCard().tools).toContain("hive_list_friends");
  });
});
