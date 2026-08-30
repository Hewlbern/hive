import { HiveRoom } from "@/components/hive-room";

export default async function HivePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <HiveRoom code={code} />;
}
