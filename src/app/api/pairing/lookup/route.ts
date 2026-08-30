import { clearBinding, getBinding } from "@/server/pairing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const guildId = url.searchParams.get("guildId");
  const discordUserId = url.searchParams.get("discordUserId");
  if (!guildId || !discordUserId) {
    return Response.json({ error: "guildId and discordUserId required" }, { status: 400 });
  }
  const binding = getBinding(guildId, discordUserId);
  return Response.json({ binding });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const guildId = url.searchParams.get("guildId");
  const discordUserId = url.searchParams.get("discordUserId");
  if (!guildId || !discordUserId) {
    return Response.json({ error: "guildId and discordUserId required" }, { status: 400 });
  }
  const ok = clearBinding(guildId, discordUserId);
  return Response.json({ ok });
}
