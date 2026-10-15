import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { draftCasesRequestSchema, generateDraftCases, prepareDraftCases } from "@/server/services/ai-service";
import { withAi } from "../_errors";

// ?preview=1 returns exactly what would be sent, without calling the provider.
export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  const body = await parseJson(req, draftCasesRequestSchema);
  if (new URL(req.url).searchParams.get("preview") === "1") {
    const { prepared } = await prepareDraftCases(getPrisma(), appId, body);
    return prepared;
  }
  return withAi(() => generateDraftCases(getPrisma(), appId, body, user.displayName));
});
