import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LlamaRuntime, mapLlamaWeights, readLlamaConfig } from "./llama2";
import { loadLlamaTokenizer } from "./tokenizer";

describe("hive nano checkpoint", () => {
  const weights = readFileSync(join(process.cwd(), "public/models/stories260K.bin"));
  const tok = readFileSync(join(process.cwd(), "public/models/tok512.bin"));

  it("reads a real llama2.c header", () => {
    const cfg = readLlamaConfig(weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength));
    expect(cfg.nLayers).toBe(5);
    expect(cfg.dim).toBeGreaterThan(16);
    expect(cfg.vocabSize).toBe(512);
  });

  it("generates real tokens from the weights", () => {
    const buffer = weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength);
    const cfg = readLlamaConfig(buffer);
    const w = mapLlamaWeights(buffer, cfg);
    const runtime = new LlamaRuntime(cfg, w, {
      start: 0,
      end: cfg.nLayers,
      ownsEmbed: true,
      ownsHead: true,
    });
    const tokenizer = loadLlamaTokenizer(tok.buffer.slice(tok.byteOffset, tok.byteOffset + tok.byteLength));
    const ids = tokenizer.encode("Once upon a time", true, false);
    expect(ids.length).toBeGreaterThan(1);
    let hidden = runtime.embed(ids[0]);
    runtime.runLayers(hidden, 0);
    for (let i = 1; i < ids.length; i++) {
      hidden = runtime.embed(ids[i]);
      runtime.runLayers(hidden, i);
    }
    const logits = runtime.head(hidden);
    expect(logits.length).toBe(cfg.vocabSize);
    const token = runtime.sample(logits, 0);
    const piece = tokenizer.decode(ids[ids.length - 1], token);
    expect(typeof piece).toBe("string");
    expect(token).toBeGreaterThanOrEqual(0);
    expect(token).toBeLessThan(cfg.vocabSize);
  });
});
