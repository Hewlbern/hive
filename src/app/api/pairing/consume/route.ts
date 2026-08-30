import { consumePairingCode } from "@/server/pairing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    code?: string;
    discordUserId?: string;
    guildId?: string;
  };
  if (!body.code || !body.discordUserId || !body.guildId) {
    return Response.json(
      { error: "code, discordUserId, and guildId required" },
      { status: 400 },
    );
  }
  const binding = consumePairingCode(body.code, body.discordUserId, body.guildId);
  if (!binding) {
    return Response.json({ error: "unknown or expired code" }, { status: 404 });
  }
  return Response.json({ ok: true, binding });
}
