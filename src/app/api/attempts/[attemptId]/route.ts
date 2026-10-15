import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { attemptUpdateSchema, discardDraft, saveAttemptDraft } from "@/server/services/execution-service";

type Ctx = { params: Promise<{ attemptId: string }> };

export const PATCH = api<Ctx>(async (req, { params }) => {
  const { attemptId } = await params;
  return saveAttemptDraft(getPrisma(), attemptId, await parseJson(req, attemptUpdateSchema));
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  const { attemptId } = await params;
  await discardDraft(getPrisma(), attemptId);
  return { ok: true };
});
