export type DeviceKind = "phone" | "laptop" | "desktop" | "unknown";

export type ConnectionQuality = "good" | "ok" | "poor" | "offline";

export type EngineKind = "hive-kernel" | "web-llm" | "protocol";

export type SplitKind = "pipeline" | "single";

export type Member = {
  id: string;
  name: string;
  kind: DeviceKind;
  vramMB: number;
  webgpu: boolean;
  sharing: boolean;
  online: boolean;
  layers: [number, number] | null;
  tokPerSec: number;
  earnedSession: number;
  spentSession: number;
  quality: ConnectionQuality;
  busy: boolean;
  safari: boolean;
};

export type PoolSnapshot = {
  code: string;
  members: number;
  sharing: number;
  pooledMB: number;
  selectedModelId: string | null;
  activeModelId: string | null;
  warning: string | null;
};

export type CatalogEntryView = {
  id: string;
  name: string;
  params: string;
  bits: number;
  layers: number;
  vramMB: number;
  engine: EngineKind;
  split: SplitKind;
  live: boolean;
  unlocked: boolean;
  hint: string | null;
  note: string;
};

export type LayerAssignment = {
  deviceId: string;
  start: number;
  end: number;
};

export type ChatRole = "you" | "swarm" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  authorId?: string;
  authorName?: string;
  text: string;
  modelId?: string;
  live?: boolean;
};

export type WalletSnapshot = {
  deviceId: string;
  balance: number;
  sessionEarned: number;
  sessionSpent: number;
  poolBalance: number;
  testMode: boolean;
  rail: "demo" | "stripe" | "lightning";
};

export type TopUpRecord = {
  id: string;
  at: number;
  credits: number;
  usd: number;
  rail: "demo" | "stripe" | "lightning" | "pool";
  note: string;
};

export type GenerateRequest = {
  generationId: string;
  requesterId: string;
  modelId: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  assignments: LayerAssignment[];
  payFromPool: boolean;
};

export type TokenEvent = {
  generationId: string;
  index: number;
  token: string;
  tokenId?: number;
  done: boolean;
  tokPerSec: number;
};

export type PayEvent = {
  generationId: string;
  requesterId: string;
  splits: { deviceId: string; credits: number }[];
  requesterDebit: number;
  source: "wallet" | "pool";
  balances: Record<string, number>;
  earned: Record<string, number>;
  poolBalance: number;
};

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string | null; mid: string | null };

export type ClientToServer =
  | {
      type: "join";
      code: string;
      member: Pick<
        Member,
        "id" | "name" | "kind" | "vramMB" | "webgpu" | "sharing" | "safari"
      >;
    }
  | { type: "leave" }
  | {
      type: "share";
      sharing: boolean;
      vramMB: number;
      webgpu: boolean;
      kind: DeviceKind;
    }
  | { type: "select-model"; modelId: string }
  | { type: "signal"; to: string; payload: SignalPayload }
  | { type: "generate"; request: GenerateRequest }
  | { type: "token"; event: TokenEvent }
  | { type: "abort"; generationId: string }
  | {
      type: "heartbeat";
      tokPerSec?: number;
      busy?: boolean;
      quality?: ConnectionQuality;
      sharing?: boolean;
      vramMB?: number;
      webgpu?: boolean;
    }
  | { type: "activation-fallback"; generationId: string; to: string; data: number[]; pos: number; token: number }
  | { type: "rename"; name: string };

export type ServerToClient =
  | { type: "welcome"; member: Member; wallet: WalletSnapshot; pool: PoolSnapshot }
  | { type: "roster"; members: Member[]; pool: PoolSnapshot; catalog: CatalogEntryView[]; assignments: LayerAssignment[] }
  | { type: "wallet"; wallet: WalletSnapshot }
  | { type: "signal"; from: string; payload: SignalPayload }
  | { type: "generate"; request: GenerateRequest }
  | { type: "token"; event: TokenEvent }
  | { type: "pay"; event: PayEvent }
  | { type: "abort"; generationId: string; reason: string }
  | { type: "error"; message: string }
  | { type: "activation-fallback"; generationId: string; from: string; data: number[]; pos: number; token: number };

export const CREDIT_PER_TOKEN = 1;
export const DEFAULT_MAX_TOKENS = 64;
export const DEMO_STARTER_CREDITS = 400;
export const HIVE_POOL_STARTER = 5000;
export const HEARTBEAT_MS = 4000;
export const OFFLINE_AFTER_MS = 12000;
