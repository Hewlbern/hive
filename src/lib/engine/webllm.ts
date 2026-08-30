import type { ModelDef } from "@/lib/models";

export type WebllmHandle = {
  generate: (
    prompt: string,
    opts: {
      maxTokens: number;
      temperature: number;
      abort: AbortSignal;
      onToken: (token: string, done: boolean) => void;
    },
  ) => Promise<void>;
  unload: () => Promise<void>;
};

type EngineLike = {
  chat: {
    completions: {
      create: (args: {
        messages: { role: string; content: string }[];
        stream: boolean;
        temperature: number;
        max_tokens: number;
      }) => Promise<AsyncIterable<{ choices: { delta?: { content?: string } }[] }>>;
    };
  };
  unload?: () => Promise<void>;
};

let cached: { id: string; engine: EngineLike } | null = null;

export async function loadWebllm(
  model: ModelDef,
  onProgress?: (text: string) => void,
): Promise<WebllmHandle> {
  if (!model.webllmId) throw new Error("Not a WebLLM model");
  const webllm = await import("@mlc-ai/web-llm");
  if (cached?.id === model.webllmId) {
    return wrap(cached.engine);
  }
  if (cached) {
    try {
      await cached.engine.unload?.();
    } catch {
      /* ignore */
    }
    cached = null;
  }
  const engine = (await webllm.CreateMLCEngine(model.webllmId, {
    initProgressCallback: (info: { text: string }) => onProgress?.(info.text),
  })) as unknown as EngineLike;
  cached = { id: model.webllmId, engine };
  return wrap(engine);
}

function wrap(engine: EngineLike): WebllmHandle {
  return {
    async generate(prompt, opts) {
      const stream = await engine.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        stream: true,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      });
      for await (const chunk of stream) {
        if (opts.abort.aborted) break;
        const piece = chunk.choices?.[0]?.delta?.content ?? "";
        if (piece) opts.onToken(piece, false);
      }
      opts.onToken("", true);
    },
    async unload() {
      await engine.unload?.();
      cached = null;
    },
  };
}
