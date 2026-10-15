import { z } from "zod";
import type { Db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import type { ContextCandidate } from "@/lib/import/context-sheet";

const optional = z.string().trim().max(20000).nullish();

export const applicationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: optional,
});

export async function createApplication(db: Db, input: z.infer<typeof applicationSchema>) {
  if (await db.application.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) {
    throw conflict(`An application named "${input.name}" already exists.`);
  }
  return db.application.create({ data: { name: input.name, description: input.description || null } });
}

export const environmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["DEVELOPMENT", "TEST", "DEMO", "UAT", "STAGING", "PRODUCTION", "OTHER"]),
  targetUrl: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .refine((v) => !v || /^https?:\/\//i.test(v), "Target URL must start with http:// or https://"),
  notes: optional,
});

export async function createEnvironment(db: Db, applicationId: string, input: z.infer<typeof environmentSchema>) {
  if (await db.environment.findFirst({ where: { applicationId, name: input.name } })) {
    throw conflict(`Environment "${input.name}" already exists.`);
  }
  return db.environment.create({
    data: { applicationId, name: input.name, type: input.type, targetUrl: input.targetUrl || null, notes: input.notes || null },
  });
}

export const sourceSchema = z.object({
  kind: z.enum(["WORKBOOK", "DOCUMENT", "URL", "REPOSITORY", "CONVERSATION", "OTHER"]),
  title: z.string().trim().min(1).max(300),
  location: z.string().trim().max(2000).nullish(),
  notes: optional,
});

export async function createSource(db: Db, applicationId: string, input: z.infer<typeof sourceSchema>) {
  return db.sourceReference.create({
    data: { applicationId, kind: input.kind, title: input.title, location: input.location || null, notes: input.notes || null },
  });
}

const category = z.enum([
  "ROLES_PERMISSIONS",
  "BUSINESS_WORKFLOWS",
  "BUSINESS_RULES",
  "TECHNICAL_DETAILS",
  "REQUIREMENTS_REFERENCES",
  "CONSTRAINTS_GAPS",
]);

export const contextEntrySchema = z.object({
  category,
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  status: z.enum(["UNREVIEWED", "REVIEWED", "OUTDATED"]).default("UNREVIEWED"),
  sourceReferenceId: z.string().nullish(),
  sourceExcerpt: optional,
});

async function checkSource(db: Db, applicationId: string, id: string | null | undefined) {
  if (!id) return;
  const s = await db.sourceReference.findFirst({ where: { id, applicationId } });
  if (!s) throw badRequest("Source reference does not belong to this application.");
}

export async function createContextEntry(db: Db, applicationId: string, input: z.infer<typeof contextEntrySchema>, user: string) {
  await checkSource(db, applicationId, input.sourceReferenceId);
  return db.contextEntry.create({
    data: {
      applicationId,
      ...input,
      sourceReferenceId: input.sourceReferenceId || null,
      sourceExcerpt: input.sourceExcerpt || null,
      ...(input.status === "REVIEWED" ? { reviewedBy: user, reviewedAt: new Date() } : {}),
    },
  });
}

export async function updateContextEntry(
  db: Db,
  applicationId: string,
  id: string,
  input: Partial<z.infer<typeof contextEntrySchema>>,
  user: string,
) {
  const e = await db.contextEntry.findFirst({ where: { id, applicationId } });
  if (!e) throw notFound("Context entry not found.");
  await checkSource(db, applicationId, input.sourceReferenceId);
  // Changing the wording of a reviewed entry invalidates the review.
  const contentChanged = (input.title !== undefined && input.title !== e.title) || (input.body !== undefined && input.body !== e.body);
  if (contentChanged && !input.status && e.status === "REVIEWED") input = { ...input, status: "UNREVIEWED" };
  const statusChange =
    input.status && input.status !== e.status
      ? input.status === "REVIEWED"
        ? { reviewedBy: user, reviewedAt: new Date() }
        : { reviewedBy: null, reviewedAt: null }
      : {};
  return db.contextEntry.update({ where: { id }, data: { ...input, ...statusChange } });
}

export async function deleteContextEntry(db: Db, applicationId: string, id: string) {
  const e = await db.contextEntry.findFirst({ where: { id, applicationId } });
  if (!e) throw notFound("Context entry not found.");
  await db.contextEntry.delete({ where: { id } });
}

/** Save sheet-derived candidates as UNREVIEWED entries linked to their source. */
export async function importContextCandidates(
  db: Db,
  applicationId: string,
  file: { name: string; sheetName: string },
  candidates: ContextCandidate[],
) {
  if (!candidates.length) throw badRequest("No text blocks found in that sheet.");
  return db.$transaction(async (tx) => {
    const src = await tx.sourceReference.create({
      data: {
        applicationId,
        kind: "WORKBOOK",
        title: file.name,
        location: `Sheet "${file.sheetName}"`,
        notes: "Guidance sheet imported as unreviewed application context.",
      },
    });
    await tx.contextEntry.createMany({
      data: candidates.map((c) => ({
        applicationId,
        category: c.category,
        title: c.title,
        body: c.body,
        status: "UNREVIEWED" as const,
        sourceReferenceId: src.id,
        sourceExcerpt: `${file.sheetName}, ${c.sourceRows}`,
      })),
    });
    return { sourceId: src.id, created: candidates.length };
  });
}

export const findingUpdateSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]),
  resolutionNote: z.string().trim().max(4000).nullish(),
});

export async function updateFinding(db: Db, applicationId: string, id: string, input: z.infer<typeof findingUpdateSchema>) {
  const f = await db.finding.findFirst({ where: { id, applicationId } });
  if (!f) throw notFound("Flag not found.");
  if (input.status !== "OPEN" && !input.resolutionNote?.trim()) throw badRequest("Add a note explaining the resolution.");
  return db.finding.update({
    where: { id },
    data: {
      status: input.status,
      resolutionNote: input.resolutionNote || null,
      resolvedAt: input.status === "OPEN" ? null : new Date(),
    },
  });
}

export const manualFindingSchema = z.object({
  cycleCaseId: z.string(),
  type: z.enum(["APPLICATION_FAILURE", "BLOCKED_OR_SETUP", "INCOMPLETE_TESTING", "AMBIGUOUS_OR_OUTDATED"]),
  message: z.string().trim().min(1).max(4000),
});

export async function createManualFinding(db: Db, applicationId: string, input: z.infer<typeof manualFindingSchema>, user: string) {
  const cc = await db.cycleCase.findFirst({
    where: { id: input.cycleCaseId, cycle: { applicationId } },
    include: { attempts: { where: { status: "COMPLETED" }, orderBy: { attemptNumber: "desc" }, take: 1 } },
  });
  if (!cc) throw notFound("Cycle case not found.");
  return db.finding.create({
    data: {
      applicationId,
      testCaseId: cc.testCaseId,
      cycleCaseId: cc.id,
      attemptId: cc.attempts[0]?.id ?? null,
      type: input.type,
      source: "MANUAL",
      message: input.message,
      createdBy: user,
    },
  });
}
