import { z } from "zod";
import { api, badRequest, notFound, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import {
  acceptDraftCase,
  acceptDraftSchema,
  acceptFinding,
  acceptFindingSchema,
  acceptReportSummary,
} from "@/server/services/ai-service";
import { acceptRecipe, acceptRecipeSchema } from "@/server/services/recipe-service";

export const POST = api<{ params: Promise<{ appId: string; itemId: string }> }>(async (req, { params, user }) => {
  const { appId, itemId } = await params;
  const db = getPrisma();
  const item = await db.aiProposalItem.findUnique({ where: { id: itemId }, include: { proposal: true } });
  if (!item || item.proposal.applicationId !== appId) throw notFound("Proposal item not found.");
  switch (item.proposal.kind) {
    case "DRAFT_CASES":
      return acceptDraftCase(db, appId, itemId, await parseJson(req, acceptDraftSchema), user.displayName);
    case "REVIEW_RESULTS":
      return acceptFinding(db, appId, itemId, await parseJson(req, acceptFindingSchema), user.displayName);
    case "REPORT_SUMMARY": {
      const { text } = await parseJson(req, z.object({ text: z.string().max(20000) }));
      return acceptReportSummary(db, appId, itemId, text, user.displayName);
    }
    case "RECIPE":
      return acceptRecipe(db, appId, itemId, await parseJson(req, acceptRecipeSchema), user.displayName);
    default:
      throw badRequest("Unknown proposal type.");
  }
});
