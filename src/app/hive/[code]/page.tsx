import { HiveRoom } from "@/components/hive-room";
import { normalizeSwarmId } from "@/lib/swarm-id";

export default async function HivePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <HiveRoom code={normalizeSwarmId(decodeURIComponent(code))} />;
}
