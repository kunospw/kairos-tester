import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { runView } from "@/server/services/run-service";

// Live status, polled by the run screen.
export const GET = api<{ params: Promise<{ appId: string; runId: string }> }>(async (_req, { params }) => {
  const { appId, runId } = await params;
  return runView(getPrisma(), appId, runId);
}, { agent: true });
