import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { draftRecipeRequestSchema, generateRecipeDraft, prepareRecipeDraft } from "@/server/services/recipe-service";
import { withAi } from "../_errors";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  const body = await parseJson(req, draftRecipeRequestSchema);
  if (new URL(req.url).searchParams.get("preview") === "1") {
    const { prepared } = await prepareRecipeDraft(getPrisma(), appId, body);
    return prepared.submitted;
  }
  return withAi(() => generateRecipeDraft(getPrisma(), appId, body, user.displayName));
});
