import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { cancelRun } from "@/server/services/run-service";

export const POST = api<{ params: Promise<{ appId: string; runId: string }> }>(async (_req, { params, user }) => {
  const { appId, runId } = await params;
  await cancelRun(getPrisma(), appId, runId, user.displayName);
  return { ok: true };
}, { agent: true });
