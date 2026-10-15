import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { agentRunSchema, recordAgentRun } from "@/server/services/execution-service";

// Records an AI-driven run as AWAITING_REVIEW. Evidence is then added through
// /api/attempts/[attemptId]/evidence. A person completes the attempt.
export const POST = api<{ params: Promise<{ ccId: string }> }>(async (req, { params, user }) => {
  const { ccId } = await params;
  return recordAgentRun(getPrisma(), ccId, await parseJson(req, agentRunSchema), user.displayName);
}, { agent: true });
