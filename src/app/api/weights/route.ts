/**
 * Proxy + slice Hugging Face checkpoints so phones only download their layers
 * when we know the layout. For v1 we stream the file and let the client cache
 * it in Cache Storage / OPFS.
 */
export const runtime = "nodejs";

const ALLOWED: Record<string, string> = {
  "hive-nano": "/models/stories260K.bin",
  "hive-nano-tok": "/models/tok512.bin",
  "hive-15": "https://huggingface.co/karpathy/tinyllamas/resolve/main/stories15M.bin",
  "hive-15-tok": "https://huggingface.co/karpathy/tinyllamas/resolve/main/tokenizer.bin",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const target = ALLOWED[id];
  if (!target) return Response.json({ error: "unknown weights" }, { status: 404 });

  if (target.startsWith("/")) {
    const origin = url.origin;
    const res = await fetch(`${origin}${target}`);
    return new Response(res.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const res = await fetch(target);
  if (!res.ok) return Response.json({ error: "upstream" }, { status: res.status });
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
