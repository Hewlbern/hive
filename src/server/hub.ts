import { assignFromRoster, assignSingleDevice, applyAssignments } from "@/lib/assign";
import {
  applyTokenSettlement,
  releaseUnused,
  reserveForPrompt,
} from "@/lib/ledger";
import {
  buildCatalog,
  getModel,
  pickRunnableModel,
  pooledMB,
  sharingMembers,
} from "@/lib/models";
import {
  CREDIT_PER_TOKEN,
  DEFAULT_MAX_TOKENS,
  OFFLINE_AFTER_MS,
  type ClientToServer,
  type GenerateRequest,
  type LayerAssignment,
  type Member,
  type PayEvent,
  type PoolSnapshot,
  type ServerToClient,
  type WalletSnapshot,
} from "@/lib/protocol";
import {
  creditWallet,
  getPool,
  getWallet,
  isLightningConfigured,
  isStripeConfigured,
  setPool,
  setWallet,
  snapshotBalances,
} from "./ledger-store";

type Subscriber = (msg: ServerToClient) => void;

type Generation = {
  request: GenerateRequest;
  reserved: number;
  source: "wallet" | "pool";
  tokens: number;
  requesterWalletBefore: number;
};

type Building = {
  code: string;
  members: Map<string, Member>;
  lastSeen: Map<string, number>;
  selectedModelId: string | null;
  generation: Generation | null;
  passcode?: string;
};

type HubGlobals = {
  buildings: Map<string, Building>;
  subscribers: Map<string, Set<Subscriber>>;
  sessionEarned: Map<string, number>;
  sessionSpent: Map<string, number>;
};

const g = globalThis as unknown as { __hive?: HubGlobals };
if (!g.__hive) {
  g.__hive = {
    buildings: new Map(),
    subscribers: new Map(),
    sessionEarned: new Map(),
    sessionSpent: new Map(),
  };
}
const buildings = g.__hive.buildings;
const subscribers = g.__hive.subscribers;
const sessionEarned = g.__hive.sessionEarned;
const sessionSpent = g.__hive.sessionSpent;

function ensureBuilding(code: string): Building {
  const key = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "HIVE";
  let b = buildings.get(key);
  if (!b) {
    b = {
      code: key,
      members: new Map(),
      lastSeen: new Map(),
      selectedModelId: null,
      generation: null,
    };
    buildings.set(key, b);
  }
  return b;
}

function deviceKey(deviceId: string, code: string) {
  return `${code}:${deviceId}`;
}

function walletSnap(deviceId: string, code: string): WalletSnapshot {
  return {
    deviceId,
    balance: getWallet(deviceId),
    sessionEarned: sessionEarned.get(deviceId) ?? 0,
    sessionSpent: sessionSpent.get(deviceId) ?? 0,
    poolBalance: getPool(code),
    testMode: !isStripeConfigured(),
    rail: isLightningConfigured() ? "lightning" : isStripeConfigured() ? "stripe" : "demo",
  };
}

function poolSnap(b: Building): PoolSnapshot {
  const members = [...b.members.values()];
  const { model, warning } = pickRunnableModel(b.selectedModelId, members);
  return {
    code: b.code,
    members: members.length,
    sharing: sharingMembers(members).length,
    pooledMB: pooledMB(members),
    selectedModelId: b.selectedModelId,
    activeModelId: model?.id ?? null,
    warning,
  };
}

function assignmentsFor(b: Building, modelId?: string | null): LayerAssignment[] {
  const members = [...b.members.values()];
  const { model } = pickRunnableModel(modelId ?? b.selectedModelId, members);
  if (!model) return [];
  if (model.split === "single") {
    return assignSingleDevice(
      sharingMembers(members).map((m) => ({ id: m.id, vramMB: m.vramMB, webgpu: m.webgpu })),
      model.layers,
      model.vramMB,
      model.engine === "web-llm",
    );
  }
  return assignFromRoster(members, model.layers);
}

function currentAssignments(b: Building): LayerAssignment[] {
  return assignmentsFor(b);
}

function refreshMemberLayers(b: Building) {
  const assignments = currentAssignments(b);
  const updated = applyAssignments([...b.members.values()], assignments);
  b.members = new Map(updated.map((m) => [m.id, m]));
  return assignments;
}

function rosterPayload(b: Building): ServerToClient {
  const assignments = refreshMemberLayers(b);
  const members = [...b.members.values()];
  return {
    type: "roster",
    members,
    pool: poolSnap(b),
    catalog: buildCatalog(members),
    assignments,
  };
}

function emitTo(deviceId: string, msg: ServerToClient) {
  const set = subscribers.get(deviceId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(msg);
    } catch (err) {
      console.warn("[hive] subscriber error", err);
    }
  }
}

function broadcast(b: Building, msg: ServerToClient, except?: string) {
  for (const id of b.members.keys()) {
    if (id === except) continue;
    emitTo(id, msg);
  }
}

function broadcastRoster(b: Building) {
  const msg = rosterPayload(b);
  broadcast(b, msg);
}

export function subscribe(deviceId: string, fn: Subscriber): () => void {
  let set = subscribers.get(deviceId);
  if (!set) {
    set = new Set();
    subscribers.set(deviceId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(deviceId);
  };
}

function prune(b: Building) {
  const now = Date.now();
  let changed = false;
  for (const [id, seen] of b.lastSeen) {
    if (now - seen > OFFLINE_AFTER_MS) {
      const m = b.members.get(id);
      if (m && m.online) {
        m.online = false;
        m.sharing = false;
        m.quality = "offline";
        m.layers = null;
        changed = true;
      }
    }
  }
  if (changed) {
    if (b.generation) {
      const { model } = pickRunnableModel(b.selectedModelId, [...b.members.values()]);
      if (!model || !b.generation.request.assignments.every((a) => b.members.get(a.deviceId)?.sharing)) {
        finishGeneration(b, "A contributor dropped. Generation paused.");
      }
    }
    broadcastRoster(b);
  }
}

const gTimer = globalThis as unknown as { __hivePrune?: ReturnType<typeof setInterval> };
if (!gTimer.__hivePrune) {
  gTimer.__hivePrune = setInterval(() => {
    for (const b of buildings.values()) prune(b);
  }, 3000);
  gTimer.__hivePrune.unref?.();
}

function finishGeneration(b: Building, reason?: string) {
  const gen = b.generation;
  if (!gen) return;
  const unused = releaseUnused(gen.reserved, gen.tokens);
  if (unused > 0) {
    if (gen.source === "wallet") {
      setWallet(gen.request.requesterId, getWallet(gen.request.requesterId) + unused);
    } else {
      setPool(b.code, getPool(b.code) + unused);
    }
  }
  b.generation = null;
  for (const m of b.members.values()) m.busy = false;
  if (reason) broadcast(b, { type: "abort", generationId: gen.request.generationId, reason });
  broadcastRoster(b);
  emitTo(gen.request.requesterId, { type: "wallet", wallet: walletSnap(gen.request.requesterId, b.code) });
}

function findBuildingFor(deviceId: string): Building | undefined {
  for (const b of buildings.values()) {
    if (b.members.has(deviceId)) return b;
  }
  return undefined;
}

export function handleMessage(deviceId: string, msg: ClientToServer): ServerToClient[] | void {
  if (msg.type === "join") {
    const b = ensureBuilding(msg.code);
    const member: Member = {
      id: msg.member.id,
      name: msg.member.name,
      kind: msg.member.kind,
      vramMB: msg.member.vramMB,
      webgpu: msg.member.webgpu,
      sharing: msg.member.sharing,
      online: true,
      layers: null,
      tokPerSec: 0,
      earnedSession: sessionEarned.get(msg.member.id) ?? 0,
      spentSession: sessionSpent.get(msg.member.id) ?? 0,
      quality: "good",
      busy: false,
      safari: msg.member.safari,
    };
    // If they left another building, drop them there.
    for (const other of buildings.values()) {
      if (other !== b && other.members.has(deviceId)) {
        other.members.delete(deviceId);
        other.lastSeen.delete(deviceId);
        broadcastRoster(other);
      }
    }
    b.members.set(deviceId, member);
    b.lastSeen.set(deviceId, Date.now());
    getWallet(deviceId);
    const welcome: ServerToClient = {
      type: "welcome",
      member,
      wallet: walletSnap(deviceId, b.code),
      pool: poolSnap(b),
    };
    emitTo(deviceId, welcome);
    broadcastRoster(b);
    return;
  }

  const b = findBuildingFor(deviceId);
  if (!b) {
    emitTo(deviceId, { type: "error", message: "Join a building first." });
    return;
  }
  const me = b.members.get(deviceId);
  if (!me) return;
  b.lastSeen.set(deviceId, Date.now());
  me.online = true;

  switch (msg.type) {
    case "leave": {
      b.members.delete(deviceId);
      b.lastSeen.delete(deviceId);
      if (b.generation?.request.requesterId === deviceId) {
        finishGeneration(b, "Requester left.");
      } else if (b.generation?.request.assignments.some((a) => a.deviceId === deviceId)) {
        finishGeneration(b, "A contributor left. Generation paused.");
      } else {
        broadcastRoster(b);
      }
      break;
    }
    case "share": {
      me.sharing = msg.sharing;
      me.vramMB = msg.vramMB;
      me.webgpu = msg.webgpu;
      me.kind = msg.kind;
      if (b.generation && !msg.sharing) {
        const stillFits = pickRunnableModel(
          b.generation.request.modelId,
          [...b.members.values()],
        );
        if (!stillFits.model || stillFits.model.id !== b.generation.request.modelId) {
          finishGeneration(b, stillFits.warning ?? "Pool no longer fits the active model.");
        }
      }
      broadcastRoster(b);
      break;
    }
    case "select-model": {
      const model = getModel(msg.modelId);
      if (!model) {
        emitTo(deviceId, { type: "error", message: "Unknown model." });
        break;
      }
      b.selectedModelId = msg.modelId;
      const pick = pickRunnableModel(msg.modelId, [...b.members.values()]);
      if (b.generation && pick.model?.id !== b.generation.request.modelId) {
        finishGeneration(b, pick.warning ?? "Active model changed.");
      }
      broadcastRoster(b);
      break;
    }
    case "rename": {
      me.name = msg.name.slice(0, 24);
      broadcastRoster(b);
      break;
    }
    case "heartbeat": {
      if (msg.tokPerSec !== undefined) me.tokPerSec = msg.tokPerSec;
      if (msg.busy !== undefined) me.busy = msg.busy;
      if (msg.quality) me.quality = msg.quality;
      break;
    }
    case "signal": {
      emitTo(msg.to, { type: "signal", from: deviceId, payload: msg.payload });
      break;
    }
    case "activation-fallback": {
      emitTo(msg.to, {
        type: "activation-fallback",
        generationId: msg.generationId,
        from: deviceId,
        data: msg.data,
        pos: msg.pos,
        token: msg.token,
      });
      break;
    }
    case "generate": {
      startGeneration(b, deviceId, msg.request);
      break;
    }
    case "token": {
      onToken(b, deviceId, msg.event);
      break;
    }
    case "abort": {
      if (b.generation?.request.generationId === msg.generationId) {
        finishGeneration(b, "Stopped.");
      }
      break;
    }
  }
}

function startGeneration(b: Building, requesterId: string, incoming: GenerateRequest) {
  const members = [...b.members.values()];
  const pick = pickRunnableModel(incoming.modelId || b.selectedModelId, members);
  if (!pick.model) {
    emitTo(requesterId, { type: "error", message: pick.warning ?? "Nothing unlocked yet." });
    return;
  }
  const assignments = assignmentsFor(b, pick.model.id);
  if (assignments.length === 0) {
    emitTo(requesterId, {
      type: "error",
      message: "Join is free. Running a model is not — someone has to share compute.",
    });
    return;
  }
  const maxTokens = Math.min(Math.max(incoming.maxTokens || DEFAULT_MAX_TOKENS, 8), 256);
  const reserved = reserveForPrompt(
    getWallet(requesterId),
    getPool(b.code),
    maxTokens,
    incoming.payFromPool,
  );
  if (!reserved.ok) {
    emitTo(requesterId, {
      type: "error",
      message: `Need ${reserved.needed} credits (1 credit = 1 token). Wallet ${reserved.wallet}, office pool ${reserved.pool}. Top up to keep generating.`,
    });
    return;
  }
  if (reserved.source === "wallet") setWallet(requesterId, reserved.walletAfter);
  else {
    setWallet(requesterId, reserved.walletAfter);
    setPool(b.code, reserved.poolAfter);
  }

  const request: GenerateRequest = {
    ...incoming,
    generationId: incoming.generationId,
    requesterId,
    modelId: pick.model.id,
    maxTokens,
    assignments,
    payFromPool: reserved.source === "pool",
  };
  b.generation = {
    request,
    reserved: reserved.reserved,
    source: reserved.source,
    tokens: 0,
    requesterWalletBefore: getWallet(requesterId) + (reserved.source === "wallet" ? reserved.reserved : 0),
  };
  for (const m of b.members.values()) {
    m.busy = assignments.some((a) => a.deviceId === m.id) || m.id === requesterId;
  }
  broadcast(b, { type: "generate", request });
  emitTo(requesterId, { type: "wallet", wallet: walletSnap(requesterId, b.code) });
  if (pick.warning) {
    emitTo(requesterId, { type: "error", message: pick.warning });
  }
}

function onToken(b: Building, fromId: string, event: { generationId: string; index: number; token: string; done: boolean; tokPerSec: number }) {
  const gen = b.generation;
  if (!gen || gen.request.generationId !== event.generationId) return;
  const model = getModel(gen.request.modelId);
  const nLayers = model?.layers ?? 1;

  if (!event.done) {
    const settled = applyTokenSettlement({
      reservedLeft: gen.reserved,
      assignments: gen.request.assignments,
      nLayers,
      requesterId: gen.request.requesterId,
      balances: snapshotBalances(),
      poolBalance: getPool(b.code),
      source: gen.source,
    });
    gen.reserved = settled.reservedLeft;
    gen.tokens += 1;
    for (const [id, amount] of Object.entries(settled.balances)) {
      setWallet(id, amount);
    }
    for (const s of settled.splits) {
      sessionEarned.set(s.deviceId, (sessionEarned.get(s.deviceId) ?? 0) + s.credits);
      const worker = b.members.get(s.deviceId);
      if (worker) worker.earnedSession = sessionEarned.get(s.deviceId) ?? 0;
    }
    sessionSpent.set(
      gen.request.requesterId,
      (sessionSpent.get(gen.request.requesterId) ?? 0) + settled.requesterDebit,
    );
    const req = b.members.get(gen.request.requesterId);
    if (req) req.spentSession = sessionSpent.get(gen.request.requesterId) ?? 0;
    if (fromId) {
      const runner = b.members.get(fromId);
      if (runner) runner.tokPerSec = event.tokPerSec;
    }

    const pay: PayEvent = {
      generationId: event.generationId,
      requesterId: gen.request.requesterId,
      splits: settled.splits,
      requesterDebit: settled.requesterDebit,
      source: gen.source,
      balances: settled.balances,
      poolBalance: getPool(b.code),
    };
    broadcast(b, { type: "pay", event: pay });
  }

  broadcast(b, { type: "token", event });

  if (event.done || gen.reserved < CREDIT_PER_TOKEN) {
    if (!event.done && gen.reserved < CREDIT_PER_TOKEN) {
      broadcast(b, {
        type: "abort",
        generationId: event.generationId,
        reason: "Out of credits. Top up to resume.",
      });
    }
    finishGeneration(b);
  }
}

export function notifyWallets(code: string, deviceIds: string[]) {
  const b = buildings.get(code.toUpperCase());
  for (const id of deviceIds) {
    emitTo(id, { type: "wallet", wallet: walletSnap(id, code.toUpperCase()) });
  }
  if (b) {
    for (const id of b.members.keys()) {
      emitTo(id, { type: "wallet", wallet: walletSnap(id, b.code) });
    }
    broadcastRoster(b);
  }
}

export function getBuildingPublic(code: string) {
  const b = ensureBuilding(code);
  const members = [...b.members.values()];
  return {
    code: b.code,
    pool: poolSnap(b),
    catalog: buildCatalog(members),
    members,
  };
}

export function seedHive() {
  ensureBuilding("HIVE");
}

seedHive();
