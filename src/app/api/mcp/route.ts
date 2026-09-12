import { handleMcpHttp } from "@/server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleMcpHttp(req);
}

export async function POST(req: Request) {
  return handleMcpHttp(req);
}

export async function DELETE(req: Request) {
  return handleMcpHttp(req);
}

export async function OPTIONS(req: Request) {
  return handleMcpHttp(req);
}
