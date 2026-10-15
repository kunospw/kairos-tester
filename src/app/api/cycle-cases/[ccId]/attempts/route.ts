import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { startOrResumeAttempt } from "@/server/services/execution-service";

// Start a new attempt (a retest when earlier attempts exist) or resume the open one.
export const POST = api<{ params: Promise<{ ccId: string }> }>(async (_req, { params, user }) => {
  const { ccId } = await params;
  return startOrResumeAttempt(getPrisma(), ccId, user.displayName);
});
