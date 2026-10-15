import { z } from "zod";
import type { Db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import { caseContentSchema, changedFields, insertVersion, latestVersion, type CaseContent } from "@/server/services/case-content";

export const newCaseSchema = caseContentSchema.extend({
  externalId: z.string().trim().min(1, "Case ID is required").max(100),
});

export async function createCase(db: Db, applicationId: string, input: z.infer<typeof newCaseSchema>, user: string) {
  const app = await db.application.findUnique({ where: { id: applicationId } });
  if (!app) throw notFound("Application not found.");
  const clash = await db.testCase.findFirst({
    where: { applicationId, externalId: { equals: input.externalId, mode: "insensitive" } },
  });
  if (clash) throw conflict(`Case ID ${input.externalId} already exists in this application.`);
  const { externalId, ...content } = input;
  return db.$transaction(async (tx) => {
    const tc = await tx.testCase.create({ data: { applicationId, externalId, origin: "MANUAL", createdBy: user } });
    const v = await insertVersion(tx, tc.id, content, { source: "MANUAL", createdBy: user, changeNote: "Created" });
    return { testCase: tc, version: v };
  });
}

export const editCaseSchema = caseContentSchema.extend({
  changeNote: z.string().trim().max(1000).optional(),
  basedOnVersion: z.number().int().positive(),
});

/** Editing never mutates a version: a new version is appended. */
export async function editCase(db: Db, testCaseId: string, input: z.infer<typeof editCaseSchema>, user: string) {
  return db.$transaction(async (tx) => {
    const current = await latestVersion(tx, testCaseId).catch(() => null);
    if (!current) throw notFound("Case not found.");
    if (current.versionNumber !== input.basedOnVersion) {
      throw conflict(
        `This case changed since you opened it (now version ${current.versionNumber}). Reload and re-apply your edits.`,
      );
    }
    const { changeNote, basedOnVersion: _b, ...content } = input;
    const changes = changedFields(current, content as CaseContent);
    if (changes.length === 0) throw badRequest("No changes to save.");
    const v = await insertVersion(tx, testCaseId, content as CaseContent, {
      source: "MANUAL",
      createdBy: user,
      changeNote: changeNote || `Edited: ${changes.join(", ")}`,
    });
    return { version: v, changes };
  });
}

export const automationBindingSchema = z.object({
  runnerType: z.string().trim().min(1).max(100),
  externalTestId: z.string().trim().max(300).nullish(),
  scriptRef: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(4000).nullish(),
  reviewed: z.boolean().default(false),
});

/** Stores a reference only. Nothing is executed. */
export async function setAutomationBinding(db: Db, testCaseId: string, input: z.infer<typeof automationBindingSchema>, user: string) {
  const reviewed = input.reviewed ? { reviewedBy: user, reviewedAt: new Date() } : { reviewedBy: null, reviewedAt: null };
  const data = {
    runnerType: input.runnerType,
    externalTestId: input.externalTestId || null,
    scriptRef: input.scriptRef || null,
    notes: input.notes || null,
    ...reviewed,
  };
  return db.automationBinding.upsert({ where: { testCaseId }, create: { testCaseId, ...data }, update: data });
}
