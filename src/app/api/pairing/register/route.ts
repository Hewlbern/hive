import { registerPairingCode } from "@/server/pairing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { code?: string; deviceId?: string };
  if (!body.code || !body.deviceId) {
    return Response.json({ error: "code and deviceId required" }, { status: 400 });
  }
  try {
    const entry = registerPairingCode(body.code, body.deviceId);
    return Response.json({ ok: true, code: entry.code, deviceId: entry.deviceId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "bad pairing code" },
      { status: 400 },
    );
  }
}
