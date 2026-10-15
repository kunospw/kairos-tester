import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { inputBatchSchema, queueInput } from "@/server/services/live-control";

export const POST = api<{ params: Promise<{ appId: string; runId: string }> }>(async (req, { params }) => {
  const { appId, runId } = await params;
  return queueInput(getPrisma(), appId, runId, await parseJson(req, inputBatchSchema));
});
