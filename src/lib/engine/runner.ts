import { getModel, type ModelDef } from "@/lib/models";
import type { GenerateRequest, LayerAssignment } from "@/lib/protocol";
import { decodeActivation, encodeActivation, hashId, type HiveMesh } from "@/lib/rtc";
import {
  fetchCached,
  LlamaRuntime,
  loadLlamaCheckpoint,
  sliceForAssignment,
} from "./llama2";
import { loadLlamaTokenizer, type LlamaTokenizer } from "./tokenizer";

export type RunnerHooks = {
  mesh: HiveMesh;
  selfId: string;
  sendActivationFallback: (to: string, data: number[], pos: number, token: number) => void;
  emitToken: (generationId: string, token: string, done: boolean, tokPerSec: number, tokenId?: number) => void;
  onStatus: (text: string) => void;
};

type LoadedKernel = {
  modelId: string;
  runtime: LlamaRuntime;
  tokenizer: LlamaTokenizer;
  model: ModelDef;
};

const kernelCache = new Map<string, LoadedKernel>();

type PipelineSession = {
  request: GenerateRequest;
  loaded: LoadedKernel;
  ids: number[];
  next?: LayerAssignment;
  isLast: boolean;
  isFirst: boolean;
  emitted: number;
  t0: number;
  gid: number;
  promptLen: number;
};

let session: PipelineSession | null = null;

async function loadKernel(model: ModelDef, assignment: LayerAssignment, nLayers: number): Promise<LoadedKernel> {
  const key = `${model.id}:${assignment.start}:${assignment.end}`;
  const hit = kernelCache.get(key);
  if (hit) return hit;
  if (!model.weightsUrl || !model.tokenizerUrl) throw new Error("Model has no hive-kernel weights");
  const [{ config, weights }, tokBuf] = await Promise.all([
    loadLlamaCheckpoint(model.weightsUrl),
    fetchCached(model.tokenizerUrl, "hive-weights-v1"),
  ]);
  const tokenizer = loadLlamaTokenizer(tokBuf);
  const first = assignment.start === 0;
  const last = assignment.end === nLayers;
  const runtime = new LlamaRuntime(config, weights, sliceForAssignment(nLayers, assignment, first, last));
  const loaded = { modelId: model.id, runtime, tokenizer, model };
  kernelCache.set(key, loaded);
  return loaded;
}

function sendHidden(hooks: RunnerHooks, hidden: Float32Array, pos: number, token: number) {
  if (!session || session.isLast || !session.next) return;
  const packed = encodeActivation({
    generationIdHash: session.gid,
    pos,
    token,
    hidden,
  });
  if (!hooks.mesh.send(session.next.deviceId, packed)) {
    hooks.sendActivationFallback(session.next.deviceId, Array.from(hidden), pos, token);
  }
}

export async function runGeneration(
  request: GenerateRequest,
  hooks: RunnerHooks,
  abort: AbortSignal,
): Promise<void> {
  const model = getModel(request.modelId);
  if (!model) throw new Error("Unknown model");
  const mine = request.assignments.find((a) => a.deviceId === hooks.selfId);
  if (!mine) return;

  if (model.engine === "web-llm") {
    hooks.onStatus(`Loading ${model.name} on this device (WebGPU)…`);
    const { loadWebllm } = await import("./webllm");
    const engine = await loadWebllm(model, hooks.onStatus);
    const t0 = performance.now();
    let n = 0;
    await engine.generate(request.prompt, {
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      abort,
      onToken: (piece, done) => {
        n += done ? 0 : 1;
        const tps = n / Math.max(0.001, (performance.now() - t0) / 1000);
        hooks.emitToken(request.generationId, piece, done, tps);
      },
    });
    return;
  }

  if (model.engine !== "hive-kernel") {
    hooks.onStatus(`${model.name} is protocol-ready but not live in this build.`);
    return;
  }

  hooks.onStatus(`Loading ${model.name} layers ${mine.start}–${mine.end - 1}…`);
  const loaded = await loadKernel(model, mine, model.layers);
  const ordered = [...request.assignments].sort((a, b) => a.start - b.start);
  const index = ordered.findIndex((a) => a.deviceId === hooks.selfId);
  const next = ordered[index + 1];
  const isFirst = index === 0;
  const isLast = index === ordered.length - 1;

  loaded.runtime.reset();
  const prompt = request.prompt.trim() || "Once upon a time";
  const encoded = loaded.tokenizer.encode(prompt, true, false);

  session = {
    request,
    loaded,
    ids: isFirst ? encoded : [],
    next,
    isLast,
    isFirst,
    emitted: 0,
    t0: performance.now(),
    gid: hashId(request.generationId),
    promptLen: encoded.length,
  };

  if (!isFirst) return;

  let lastHidden: Float32Array | null = null;
  for (let pos = 0; pos < encoded.length; pos++) {
    if (abort.aborted) return;
    const x = loaded.runtime.embed(encoded[pos]);
    loaded.runtime.runLayers(x, pos);
    lastHidden = x;
    if (!isLast) sendHidden(hooks, x, pos, encoded[pos]);
  }

  if (!isLast || !lastHidden) return;

  while (session && session.emitted < request.maxTokens && !abort.aborted) {
    lastHidden = takeSample(hooks, lastHidden);
    if (!lastHidden) break;
    const pos = session.ids.length - 1;
    if (pos >= loaded.runtime.config.seqLen - 1) {
      hooks.emitToken(request.generationId, "", true, tpsOf(session), undefined);
      session = null;
      break;
    }
    lastHidden = loaded.runtime.embed(session.ids[pos]);
    loaded.runtime.runLayers(lastHidden, pos);
  }
  if (session) {
    hooks.emitToken(request.generationId, "", true, tpsOf(session), undefined);
    session = null;
  }
}

function tpsOf(s: PipelineSession) {
  return s.emitted / Math.max(0.001, (performance.now() - s.t0) / 1000);
}

/** Sample one token. Returns hidden to continue from, or null if finished. */
function takeSample(hooks: RunnerHooks, hidden: Float32Array): Float32Array | null {
  if (!session) return null;
  const { loaded, request } = session;
  const logits = loaded.runtime.head(hidden);
  const tok = loaded.runtime.sample(logits, request.temperature);
  const prev = session.ids[session.ids.length - 1] ?? loaded.tokenizer.bos;
  const piece = loaded.tokenizer.decode(prev, tok);
  session.ids.push(tok);
  session.emitted += 1;
  const done =
    session.emitted >= request.maxTokens || tok === loaded.tokenizer.eos;
  hooks.emitToken(request.generationId, piece, done, tpsOf(session), tok);
  if (done) {
    session = null;
    return null;
  }
  return hidden;
}

/**
 * First hop continues decode when the last hop samples a token.
 */
export function continueFromSample(tokenId: number, hooks: RunnerHooks) {
  if (!session || !session.isFirst || session.isLast) return;
  if (session.emitted >= session.request.maxTokens) return;
  session.ids.push(tokenId);
  session.emitted += 1;
  const pos = session.ids.length - 1;
  if (pos >= session.loaded.runtime.config.seqLen - 1) return;
  const x = session.loaded.runtime.embed(tokenId);
  session.loaded.runtime.runLayers(x, pos);
  sendHidden(hooks, x, pos, tokenId);
}

export function handleIncomingActivation(data: ArrayBuffer, hooks: RunnerHooks): void {
  if (!session) return;
  const decoded = decodeActivation(data);
  if (!decoded || decoded.generationIdHash !== session.gid) return;
  const hidden = new Float32Array(decoded.hidden);
  session.loaded.runtime.runLayers(hidden, decoded.pos);

  if (!session.isLast && session.next) {
    sendHidden(hooks, hidden, decoded.pos, decoded.token);
    return;
  }
  if (decoded.pos < session.promptLen - 1) return;
  takeSample(hooks, hidden);
}

export function handleFallbackActivation(
  data: number[],
  pos: number,
  token: number,
  generationId: string,
  hooks: RunnerHooks,
) {
  if (!session || session.request.generationId !== generationId) return;
  const packed = encodeActivation({
    generationIdHash: hashId(generationId),
    pos,
    token,
    hidden: Float32Array.from(data),
  });
  handleIncomingActivation(packed, hooks);
}

export function clearSession() {
  session = null;
}

export function promptTokenLength(modelId: string, prompt: string): number {
  for (const loaded of kernelCache.values()) {
    if (loaded.modelId === modelId) {
      return loaded.tokenizer.encode(prompt.trim() || "Once upon a time", true, false).length;
    }
  }
  return Math.max(4, prompt.split(/\s+/).length + 1);
}
