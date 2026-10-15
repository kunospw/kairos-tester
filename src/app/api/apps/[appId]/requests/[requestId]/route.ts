import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { answerRequest, answerSchema } from "@/server/services/run-service";

// A person answers something the AI asked for (or decides on a result).
export const POST = api<{ params: Promise<{ appId: string; requestId: string }> }>(async (req, { params, user }) => {
  const { appId, requestId } = await params;
  return answerRequest(getPrisma(), appId, requestId, await parseJson(req, answerSchema), user.displayName);
});
