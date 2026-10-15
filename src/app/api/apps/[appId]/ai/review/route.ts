import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { generateReview, prepareReview, reviewRequestSchema } from "@/server/services/ai-service";
import { withAi } from "../_errors";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  const body = await parseJson(req, reviewRequestSchema);
  if (new URL(req.url).searchParams.get("preview") === "1") {
    const { prepared } = await prepareReview(getPrisma(), appId, body);
    return prepared;
  }
  return withAi(() => generateReview(getPrisma(), appId, body, user.displayName));
});
