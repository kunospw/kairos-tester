import { api, notFound, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { editCase, editCaseSchema } from "@/server/services/case-service";

type Ctx = { params: Promise<{ appId: string; caseId: string }> };

// Editing creates a new immutable version.
export const PATCH = api<Ctx>(async (req, { params, user }) => {
  const { appId, caseId } = await params;
  const db = getPrisma();
  if (!(await db.testCase.findFirst({ where: { id: caseId, applicationId: appId } }))) throw notFound("Case not found.");
  return editCase(db, caseId, await parseJson(req, editCaseSchema), user.displayName);
});
