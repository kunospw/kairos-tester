import { api, notFound, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { automationBindingSchema, setAutomationBinding } from "@/server/services/case-service";

type Ctx = { params: Promise<{ appId: string; caseId: string }> };

// Stores an automation reference only. Nothing is executed.
export const PUT = api<Ctx>(async (req, { params, user }) => {
  const { appId, caseId } = await params;
  const db = getPrisma();
  if (!(await db.testCase.findFirst({ where: { id: caseId, applicationId: appId } }))) throw notFound("Case not found.");
  return setAutomationBinding(db, caseId, await parseJson(req, automationBindingSchema), user.displayName);
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  const { appId, caseId } = await params;
  const db = getPrisma();
  if (!(await db.testCase.findFirst({ where: { id: caseId, applicationId: appId } }))) throw notFound("Case not found.");
  await db.automationBinding.deleteMany({ where: { testCaseId: caseId } });
  return { ok: true };
});
