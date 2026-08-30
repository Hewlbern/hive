import type { CatalogEntryView, DeviceKind, EngineKind, Member, SplitKind } from "./protocol";

export type ModelDef = {
  id: string;
  name: string;
  params: string;
  bits: number;
  layers: number;
  /** Minimum usable pooled (pipeline) or single-device (web-llm) memory in MB. */
  vramMB: number;
  engine: EngineKind;
  split: SplitKind;
  live: boolean;
  note: string;
  dim?: number;
  weightsUrl?: string;
  tokenizerUrl?: string;
  webllmId?: string;
};

/**
 * Catalog is ordered smallest → largest. Unlock is gated by the *current*
 * sharing pool, not by what someone hopes to bring later.
 *
 * Pipeline models (hive-kernel) can split across phones and laptops.
 * WebLLM models must fit on one sharing device — the library cannot
 * layer-split — but they still appear in the same catalog so the office
 * sees a single unlock ladder.
 */
export const MODEL_CATALOG: ModelDef[] = [
  {
    id: "hive-nano",
    name: "Hive Nano",
    params: "260K",
    bits: 32,
    layers: 5,
    vramMB: 8,
    engine: "hive-kernel",
    split: "pipeline",
    live: true,
    note: "Real Llama-style kernel. Completes TinyStories text. Proves layer-split.",
    weightsUrl: "/models/stories260K.bin",
    tokenizerUrl: "/models/tok512.bin",
    dim: 64,
  },
  {
    id: "hive-15",
    name: "Hive 15",
    params: "15M",
    bits: 32,
    layers: 6,
    vramMB: 80,
    engine: "hive-kernel",
    split: "pipeline",
    live: true,
    note: "Karpathy stories15M. Same pipeline kernel, better prose. ~60 MB shardable download.",
    weightsUrl: "https://huggingface.co/karpathy/tinyllamas/resolve/main/stories15M.bin",
    tokenizerUrl: "https://huggingface.co/karpathy/tinyllamas/resolve/main/tokenizer.bin",
    dim: 288,
  },
  {
    id: "qwen25-05",
    name: "Qwen 2.5 0.5B",
    params: "0.5B",
    bits: 4,
    layers: 24,
    vramMB: 950,
    engine: "web-llm",
    split: "single",
    live: true,
    note: "Real WebGPU chat via WebLLM on the strongest sharing device. Tokens still fan out over the mesh.",
    webllmId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  },
  {
    id: "qwen25-15",
    name: "Qwen 2.5 1.5B",
    params: "1.5B",
    bits: 4,
    layers: 28,
    vramMB: 1630,
    engine: "web-llm",
    split: "single",
    live: true,
    note: "Needs a laptop-class GPU in the swarm.",
    webllmId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  },
  {
    id: "qwen25-3",
    name: "Qwen 2.5 3B",
    params: "3B",
    bits: 4,
    layers: 36,
    vramMB: 2500,
    engine: "web-llm",
    split: "single",
    live: true,
    note: "A strong laptop or a desktop unlocks this.",
    webllmId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  },
  {
    id: "qwen25-7",
    name: "Qwen 2.5 7B",
    params: "7B",
    bits: 4,
    layers: 28,
    vramMB: 5100,
    engine: "web-llm",
    split: "single",
    live: true,
    note: "A handful of office machines — one of them must hold the 4-bit checkpoint.",
    webllmId: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
  },
  {
    id: "qwen25-14",
    name: "Qwen 2.5 14B",
    params: "14B",
    bits: 4,
    layers: 48,
    vramMB: 9200,
    engine: "protocol",
    split: "pipeline",
    live: false,
    note: "Assignment protocol is live. This checkpoint is not shipped in v1 — unlock it and Hive falls back to the largest live model.",
  },
  {
    id: "qwen3-27",
    name: "Qwen 3 27B",
    params: "27B",
    bits: 4,
    layers: 64,
    vramMB: 18000,
    engine: "protocol",
    split: "pipeline",
    live: false,
    note: "The office-scale target. Layer map is designed for a 27B 4-bit shard. Kernel for this checkpoint is not loaded in this build.",
  },
];

export const TYPICAL_VRAM: Record<DeviceKind, number> = {
  phone: 1500,
  laptop: 6000,
  desktop: 10000,
  unknown: 2000,
};

export function getModel(id: string): ModelDef | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function sharingMembers(members: Member[]): Member[] {
  return members.filter((m) => m.sharing && m.online);
}

export function pooledMB(members: Member[]): number {
  return sharingMembers(members).reduce((sum, m) => sum + m.vramMB, 0);
}

export function modelFits(model: ModelDef, members: Member[]): boolean {
  const workers = sharingMembers(members);
  if (workers.length === 0) return false;
  if (model.split === "single") {
    return workers.some((w) => w.vramMB >= model.vramMB && (model.engine !== "web-llm" || w.webgpu));
  }
  return pooledMB(members) >= model.vramMB;
}

export function unlockHint(model: ModelDef, members: Member[]): string | null {
  if (modelFits(model, members)) return null;
  const workers = sharingMembers(members);
  const pool = pooledMB(members);

  if (workers.length === 0) {
    return "Someone in the group has to tap Share compute";
  }

  if (model.split === "single") {
    const best = Math.max(...workers.map((w) => w.vramMB));
    const need = model.vramMB - best;
    if (need <= 0 && model.engine === "web-llm") {
      return "Needs a device with WebGPU (Chrome/Edge on a laptop)";
    }
    if (need <= 2000) return "A phone with WebGPU still isn't enough — bring a laptop";
    if (need <= 7000) return "Another laptop (or a desktop) in the swarm";
    return `A desktop-class GPU — about ${Math.ceil(need / 1024)} GB more on one machine`;
  }

  const need = model.vramMB - pool;
  if (need <= 0) return null;
  const phones = Math.max(1, Math.ceil(need / TYPICAL_VRAM.phone));
  const laptops = Math.max(1, Math.ceil(need / TYPICAL_VRAM.laptop));
  if (need <= TYPICAL_VRAM.phone) return "One more phone sharing";
  if (laptops === 1 && phones <= 3) {
    return `Another laptop, or ${phones} more phone${phones === 1 ? "" : "s"}`;
  }
  if (laptops <= 3) {
    return `About ${Math.ceil(need / 1024)} GB more — ${laptops} laptop${laptops === 1 ? "" : "s"} or ${phones} phones`;
  }
  return `About ${Math.ceil(need / 1024)} GB more pooled compute`;
}

export function buildCatalog(members: Member[]): CatalogEntryView[] {
  return MODEL_CATALOG.map((model) => {
    const unlocked = modelFits(model, members);
    return {
      id: model.id,
      name: model.name,
      params: model.params,
      bits: model.bits,
      layers: model.layers,
      vramMB: model.vramMB,
      engine: model.engine,
      split: model.split,
      live: model.live,
      unlocked,
      hint: unlockHint(model, members),
      note: model.note,
    };
  });
}

export function largestUnlockedLive(members: Member[]): ModelDef | null {
  const live = [...MODEL_CATALOG].reverse().find((m) => m.live && modelFits(m, members));
  return live ?? null;
}

export function pickRunnableModel(requestedId: string | null, members: Member[]): {
  model: ModelDef | null;
  warning: string | null;
} {
  if (sharingMembers(members).length === 0) {
    return { model: null, warning: "No one is sharing compute. The catalog is locked." };
  }
  const requested = requestedId ? getModel(requestedId) : null;
  if (requested && modelFits(requested, members) && requested.live) {
    return { model: requested, warning: null };
  }
  const fallback = largestUnlockedLive(members);
  if (requested && !requested.live && modelFits(requested, members) && fallback) {
    return {
      model: fallback,
      warning: `${requested.name} is unlocked on paper, but this build's live kernel is ${fallback.name}. Layer assignment for ${requested.params} is ready.`,
    };
  }
  if (requested && !modelFits(requested, members) && fallback) {
    return {
      model: fallback,
      warning: `${requested.name} no longer fits the pool. Fell back to ${fallback.name}.`,
    };
  }
  if (fallback) return { model: fallback, warning: null };
  return { model: null, warning: "The swarm cannot run any live model with the current pool." };
}

export function catalogHeadline(members: Member[]): string {
  const pool = pooledMB(members);
  const sharing = sharingMembers(members).length;
  const unlocked = MODEL_CATALOG.filter((m) => modelFits(m, members));
  const next = MODEL_CATALOG.find((m) => !modelFits(m, members));
  const best = [...unlocked].reverse()[0];
  const poolLabel = pool >= 1024 ? `${(pool / 1024).toFixed(1)} GB pooled` : `${Math.round(pool)} MB pooled`;
  const who = `${sharing} device${sharing === 1 ? "" : "s"}`;
  if (!best) return `${who} · ${poolLabel} · catalog locked`;
  if (!next) return `${who} · ${poolLabel} · ${best.name} unlocked`;
  const more = Math.max(0, next.vramMB - pool);
  const moreLabel = more >= 1024 ? `~${(more / 1024).toFixed(0)} GB more` : `~${Math.round(more)} MB more`;
  return `${who} · ${poolLabel} · ${best.name} unlocked · ${next.name} needs ${moreLabel}`;
}
