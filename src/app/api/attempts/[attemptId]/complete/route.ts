import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { attemptUpdateSchema, completeAttempt } from "@/server/services/execution-service";

export const POST = api<{ params: Promise<{ attemptId: string }> }>(async (req, { params, user }) => {
  const { attemptId } = await params;
  return completeAttempt(getPrisma(), attemptId, await parseJson(req, attemptUpdateSchema), user.displayName);
});
