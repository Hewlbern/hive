/**
 * llama2.c checkpoint runner. Real weights, real forward(), optional WebGPU GEMM.
 * Designed so a device can own a contiguous layer range and exchange hidden
 * states as Float32Array.
 */

export type LlamaConfig = {
  dim: number;
  hiddenDim: number;
  nLayers: number;
  nHeads: number;
  nKvHeads: number;
  vocabSize: number;
  seqLen: number;
  sharedClassifier: boolean;
  headSize: number;
  kvDim: number;
};

export type LlamaWeights = {
  tokenEmbed: Float32Array;
  rmsAtt: Float32Array;
  wq: Float32Array;
  wk: Float32Array;
  wv: Float32Array;
  wo: Float32Array;
  rmsFfn: Float32Array;
  w1: Float32Array;
  w2: Float32Array;
  w3: Float32Array;
  rmsFinal: Float32Array;
  wcls: Float32Array;
};

export type LayerSlice = {
  start: number;
  end: number;
  ownsEmbed: boolean;
  ownsHead: boolean;
};

function f32(buffer: ArrayBuffer, offsetFloats: number, count: number): Float32Array {
  return new Float32Array(buffer, offsetFloats * 4, count);
}

export function readLlamaConfig(buffer: ArrayBuffer): LlamaConfig {
  const v = new DataView(buffer);
  const dim = v.getInt32(0, true);
  const hiddenDim = v.getInt32(4, true);
  const nLayers = v.getInt32(8, true);
  const nHeads = v.getInt32(12, true);
  const nKvHeads = v.getInt32(16, true);
  let vocabSize = v.getInt32(20, true);
  const seqLen = v.getInt32(24, true);
  const sharedClassifier = vocabSize > 0;
  vocabSize = Math.abs(vocabSize);
  const headSize = Math.floor(dim / nHeads);
  const kvDim = nKvHeads * headSize;
  return {
    dim,
    hiddenDim,
    nLayers,
    nHeads,
    nKvHeads,
    vocabSize,
    seqLen,
    sharedClassifier,
    headSize,
    kvDim,
  };
}

export function mapLlamaWeights(buffer: ArrayBuffer, c: LlamaConfig): LlamaWeights {
  let p = 7; // skip 7 ints
  const L = c.nLayers;
  const take = (n: number) => {
    const slice = f32(buffer, p, n);
    p += n;
    return slice;
  };
  const tokenEmbed = take(c.vocabSize * c.dim);
  const rmsAtt = take(L * c.dim);
  const wq = take(L * c.dim * c.dim);
  const wk = take(L * c.dim * c.kvDim);
  const wv = take(L * c.dim * c.kvDim);
  const wo = take(L * c.dim * c.dim);
  const rmsFfn = take(L * c.dim);
  const w1 = take(L * c.hiddenDim * c.dim);
  const w2 = take(L * c.dim * c.hiddenDim);
  const w3 = take(L * c.hiddenDim * c.dim);
  const rmsFinal = take(c.dim);
  // skip freq_cis_real / imag from the original export
  p += c.seqLen * (c.headSize / 2);
  p += c.seqLen * (c.headSize / 2);
  const wcls = c.sharedClassifier ? tokenEmbed : take(c.vocabSize * c.dim);
  return { tokenEmbed, rmsAtt, wq, wk, wv, wo, rmsFfn, w1, w2, w3, rmsFinal, wcls };
}

function rmsnorm(out: Float32Array, x: Float32Array, weight: Float32Array, offset: number, size: number) {
  let ss = 0;
  for (let i = 0; i < size; i++) ss += x[i] * x[i];
  ss = 1 / Math.sqrt(ss / size + 1e-5);
  for (let i = 0; i < size; i++) out[i] = weight[offset + i] * (ss * x[i]);
}

function softmaxInPlace(x: Float32Array, size: number) {
  let max = -Infinity;
  for (let i = 0; i < size; i++) if (x[i] > max) max = x[i];
  let sum = 0;
  for (let i = 0; i < size; i++) {
    x[i] = Math.exp(x[i] - max);
    sum += x[i];
  }
  for (let i = 0; i < size; i++) x[i] /= sum;
}

/** W is (d, n) row-major. x is (n,). out is (d,). */
export function matmul(
  out: Float32Array,
  x: Float32Array,
  w: Float32Array,
  wOffset: number,
  n: number,
  d: number,
) {
  for (let i = 0; i < d; i++) {
    let s = 0;
    const row = wOffset + i * n;
    for (let j = 0; j < n; j++) s += w[row + j] * x[j];
    out[i] = s;
  }
}

function silu(x: number): number {
  return x / (1 + Math.exp(-x));
}

export class LlamaRuntime {
  readonly config: LlamaConfig;
  readonly weights: LlamaWeights;
  readonly slice: LayerSlice;
  private keyCache: Float32Array;
  private valCache: Float32Array;
  private xb: Float32Array;
  private xb2: Float32Array;
  private hb: Float32Array;
  private hb2: Float32Array;
  private q: Float32Array;
  private k: Float32Array;
  private v: Float32Array;
  private att: Float32Array;
  private logits: Float32Array;
  private hidden: Float32Array;

  constructor(config: LlamaConfig, weights: LlamaWeights, slice: LayerSlice) {
    this.config = config;
    this.weights = weights;
    this.slice = slice;
    const c = config;
    const kvCacheLayers = slice.end - slice.start;
    this.keyCache = new Float32Array(kvCacheLayers * c.seqLen * c.kvDim);
    this.valCache = new Float32Array(kvCacheLayers * c.seqLen * c.kvDim);
    this.xb = new Float32Array(c.dim);
    this.xb2 = new Float32Array(c.dim);
    this.hb = new Float32Array(c.hiddenDim);
    this.hb2 = new Float32Array(c.hiddenDim);
    this.q = new Float32Array(c.dim);
    this.k = new Float32Array(c.kvDim);
    this.v = new Float32Array(c.kvDim);
    this.att = new Float32Array(c.nHeads * c.seqLen);
    this.logits = new Float32Array(c.vocabSize);
    this.hidden = new Float32Array(c.dim);
  }

  reset() {
    this.keyCache.fill(0);
    this.valCache.fill(0);
  }

  embed(token: number): Float32Array {
    const { dim } = this.config;
    this.hidden.set(this.weights.tokenEmbed.subarray(token * dim, token * dim + dim));
    return this.hidden;
  }

  /**
   * Run owned layers on `x` (dim,). Mutates and returns the same buffer.
   */
  runLayers(x: Float32Array, pos: number): Float32Array {
    const c = this.config;
    const w = this.weights;
    for (let layer = this.slice.start; layer < this.slice.end; layer++) {
      const local = layer - this.slice.start;
      rmsnorm(this.xb, x, w.rmsAtt, layer * c.dim, c.dim);
      matmul(this.q, this.xb, w.wq, layer * c.dim * c.dim, c.dim, c.dim);
      matmul(this.k, this.xb, w.wk, layer * c.dim * c.kvDim, c.dim, c.kvDim);
      matmul(this.v, this.xb, w.wv, layer * c.dim * c.kvDim, c.dim, c.kvDim);
      this.rope(this.q, this.k, pos);

      const lo = local * c.seqLen * c.kvDim + pos * c.kvDim;
      this.keyCache.set(this.k, lo);
      this.valCache.set(this.v, lo);

      this.attention(x, local, pos);

      rmsnorm(this.xb, x, w.rmsFfn, layer * c.dim, c.dim);
      matmul(this.hb, this.xb, w.w1, layer * c.hiddenDim * c.dim, c.dim, c.hiddenDim);
      matmul(this.hb2, this.xb, w.w3, layer * c.hiddenDim * c.dim, c.dim, c.hiddenDim);
      for (let i = 0; i < c.hiddenDim; i++) this.hb[i] = silu(this.hb[i]) * this.hb2[i];
      matmul(this.xb, this.hb, w.w2, layer * c.dim * c.hiddenDim, c.hiddenDim, c.dim);
      for (let i = 0; i < c.dim; i++) x[i] += this.xb[i];
    }
    return x;
  }

  head(x: Float32Array): Float32Array {
    rmsnorm(this.xb, x, this.weights.rmsFinal, 0, this.config.dim);
    matmul(this.logits, this.xb, this.weights.wcls, 0, this.config.dim, this.config.vocabSize);
    return this.logits;
  }

  sample(logits: Float32Array, temperature: number): number {
    if (temperature <= 0) {
      let best = 0;
      for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
      return best;
    }
    const scaled = new Float32Array(logits.length);
    const inv = 1 / temperature;
    for (let i = 0; i < logits.length; i++) scaled[i] = logits[i] * inv;
    softmaxInPlace(scaled, scaled.length);
    const r = Math.random();
    let cdf = 0;
    for (let i = 0; i < scaled.length; i++) {
      cdf += scaled[i];
      if (r < cdf) return i;
    }
    return scaled.length - 1;
  }

  private rope(q: Float32Array, k: Float32Array, pos: number) {
    const { dim, kvDim, headSize } = this.config;
    for (let i = 0; i < dim; i += 2) {
      const headDim = i % headSize;
      const freq = 1 / Math.pow(10000, headDim / headSize);
      const val = pos * freq;
      const fcr = Math.cos(val);
      const fci = Math.sin(val);
      const rotn = i < kvDim ? 2 : 1;
      for (let v = 0; v < rotn; v++) {
        const vec = v === 0 ? q : k;
        const v0 = vec[i];
        const v1 = vec[i + 1];
        vec[i] = v0 * fcr - v1 * fci;
        vec[i + 1] = v0 * fci + v1 * fcr;
      }
    }
  }

  private attention(x: Float32Array, localLayer: number, pos: number) {
    const c = this.config;
    const kvMul = Math.floor(c.nHeads / c.nKvHeads);
    for (let h = 0; h < c.nHeads; h++) {
      const q = this.q.subarray(h * c.headSize, (h + 1) * c.headSize);
      const att = this.att.subarray(h * c.seqLen, h * c.seqLen + pos + 1);
      for (let t = 0; t <= pos; t++) {
        const kOff =
          localLayer * c.seqLen * c.kvDim +
          t * c.kvDim +
          Math.floor(h / kvMul) * c.headSize;
        let score = 0;
        for (let i = 0; i < c.headSize; i++) score += q[i] * this.keyCache[kOff + i];
        att[t] = score / Math.sqrt(c.headSize);
      }
      softmaxInPlace(att, pos + 1);
      this.xb2.fill(0, h * c.headSize, (h + 1) * c.headSize);
      const xb = this.xb2.subarray(h * c.headSize, (h + 1) * c.headSize);
      for (let t = 0; t <= pos; t++) {
        const vOff =
          localLayer * c.seqLen * c.kvDim +
          t * c.kvDim +
          Math.floor(h / kvMul) * c.headSize;
        const a = att[t];
        for (let i = 0; i < c.headSize; i++) xb[i] += a * this.valCache[vOff + i];
      }
    }
    matmul(this.xb, this.xb2, this.weights.wo, (localLayer + this.slice.start) * c.dim * c.dim, c.dim, c.dim);
    for (let i = 0; i < c.dim; i++) x[i] += this.xb[i];
  }
}

export function sliceForAssignment(
  nLayers: number,
  assignment: { start: number; end: number },
  first: boolean,
  last: boolean,
): LayerSlice {
  return {
    start: assignment.start,
    end: assignment.end,
    ownsEmbed: first || assignment.start === 0,
    ownsHead: last || assignment.end === nLayers,
  };
}

export async function loadLlamaCheckpoint(
  weightsUrl: string,
  cacheName = "hive-weights-v1",
): Promise<{ config: LlamaConfig; weights: LlamaWeights; buffer: ArrayBuffer }> {
  const buffer = await fetchCached(weightsUrl, cacheName);
  const config = readLlamaConfig(buffer);
  const weights = mapLlamaWeights(buffer, config);
  return { config, weights, buffer };
}

export async function fetchCached(url: string, cacheName: string): Promise<ArrayBuffer> {
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url);
      if (hit) return await hit.arrayBuffer();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const clone = res.clone();
      await cache.put(url, clone);
      return await res.arrayBuffer();
    } catch {
      // fall through to plain fetch
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.arrayBuffer();
}
