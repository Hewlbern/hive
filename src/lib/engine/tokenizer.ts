/**
 * llama2.c tokenizer.bin / tok512.bin loader + BPE encode/decode.
 */
export type LlamaTokenizer = {
  vocab: string[];
  scores: Float32Array;
  maxTokenLength: number;
  bos: number;
  eos: number;
  encode: (text: string, bos?: boolean, eos?: boolean) => number[];
  decode: (prev: number, token: number) => string;
  decodeIds: (ids: number[]) => string;
};

function readCString(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  let out = "";
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

export function loadLlamaTokenizer(buffer: ArrayBuffer): LlamaTokenizer {
  const view = new DataView(buffer);
  const maxTokenLength = view.getInt32(0, true);
  const scores: number[] = [];
  const vocab: string[] = [];
  let offset = 4;
  while (offset + 8 <= buffer.byteLength) {
    const score = view.getFloat32(offset, true);
    offset += 4;
    const len = view.getInt32(offset, true);
    offset += 4;
    if (len < 0 || offset + len > buffer.byteLength) break;
    const piece = readCString(new Uint8Array(buffer, offset, len));
    offset += len;
    scores.push(score);
    vocab.push(piece);
  }

  const bos = vocab.indexOf("<s>") >= 0 ? vocab.indexOf("<s>") : 1;
  const eos = vocab.indexOf("</s>") >= 0 ? vocab.indexOf("</s>") : 2;

  const scoreArr = Float32Array.from(scores);

  function encode(text: string, addBos = true, addEos = false): number[] {
    const tokens: number[] = [];
    if (addBos) tokens.push(bos);

    // byte-level fallback for 32k llama tokenizer; for tok512 the pieces are chars/words
    const chars = Array.from(text);
    for (const ch of chars) {
      const id = vocab.indexOf(ch);
      if (id >= 0) tokens.push(id);
      else {
        // try utf-8 bytes as <0xHH> style or raw bytes
        const bytes = new TextEncoder().encode(ch);
        for (const b of bytes) {
          const hex = `<0x${b.toString(16).toUpperCase().padStart(2, "0")}>`;
          const hid = vocab.indexOf(hex);
          if (hid >= 0) tokens.push(hid);
          else if (vocab[b]) tokens.push(b);
        }
      }
    }

    while (true) {
      let bestScore = -1e10;
      let bestI = -1;
      let bestId = -1;
      for (let i = 0; i < tokens.length - 1; i++) {
        const merged = vocab[tokens[i]] + vocab[tokens[i + 1]];
        const id = vocab.indexOf(merged);
        if (id >= 0 && scoreArr[id] > bestScore) {
          bestScore = scoreArr[id];
          bestI = i;
          bestId = id;
        }
      }
      if (bestI === -1) break;
      tokens[bestI] = bestId;
      tokens.splice(bestI + 1, 1);
    }

    if (addEos) tokens.push(eos);
    return tokens;
  }

  function decode(prev: number, token: number): string {
    let piece = vocab[token] ?? "";
    if (prev === bos && piece.startsWith(" ")) piece = piece.slice(1);
    if (piece.startsWith("<0x") && piece.endsWith(">")) {
      const n = parseInt(piece.slice(3, -1), 16);
      if (!Number.isNaN(n)) return String.fromCharCode(n);
    }
    return piece;
  }

  function decodeIds(ids: number[]): string {
    let prev = bos;
    let out = "";
    for (const id of ids) {
      out += decode(prev, id);
      prev = id;
    }
    return out;
  }

  return {
    vocab,
    scores: scoreArr,
    maxTokenLength,
    bos,
    eos,
    encode,
    decode,
    decodeIds,
  };
}
