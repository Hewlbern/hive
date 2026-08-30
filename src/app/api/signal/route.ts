import { handleMessage, subscribe } from "@/server/hub";
import type { ClientToServer } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deviceId = url.searchParams.get("deviceId");
  if (!deviceId) {
    return Response.json({ error: "deviceId required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsub: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      unsub = subscribe(deviceId, send);
      send({ type: "ready" });
    },
    cancel() {
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { deviceId?: string; message?: ClientToServer };
  if (!body.deviceId || !body.message) {
    return Response.json({ error: "deviceId and message required" }, { status: 400 });
  }
  handleMessage(body.deviceId, body.message);
  return Response.json({ ok: true });
}
