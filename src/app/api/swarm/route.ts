import { getBuildingPublic, seedHive } from "@/server/hub";
import { buildingCode } from "@/lib/probe";
import { normalizeSwarmId } from "@/lib/swarm-id";

export const runtime = "nodejs";

export async function GET(req: Request) {
  seedHive();
  const url = new URL(req.url);
  const code = normalizeSwarmId(url.searchParams.get("code") || "HIVE");
  return Response.json(getBuildingPublic(code));
}

export async function POST() {
  const code = buildingCode();
  const pub = getBuildingPublic(code);
  return Response.json(pub);
}
