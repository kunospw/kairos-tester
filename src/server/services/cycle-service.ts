import { z } from "zod";
import type { Db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";

export const newCycleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["STANDARD", "SIMULATION"]).default("STANDARD"),
  scope: z.string().trim().max(4000).nullish(),
  excludedScope: z.string().trim().max(4000).nullish(),
  environmentId: z.string().nullish(),
  buildLabel: z.string().trim().max(200).nullish(),
  /** Which cases to include: all active cases, or a filtered subset. */
  include: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
    z.object({ mode: z.literal("sections"), sections: z.array(z.string()).min(1) }),
    z.object({ mode: z.literal("cases"), testCaseIds: z.array(z.string()).min(1) }),
  ]),
});

/**
 * Creates a cycle whose cases all start as Not run. Each assignment points at
 * the case's current version. No historical results are carried over.
 */
export async function createCycle(db: Db, applicationId: string, input: z.infer<typeof newCycleSchema>, user: string) {
  const app = await db.application.findUnique({ where: { id: applicationId } });
  if (!app) throw notFound("Application not found.");
  if (await db.testCycle.findFirst({ where: { applicationId, name: input.name } })) {
    throw conflict(`A cycle named "${input.name}" already exists.`);
  }
  if (input.environmentId) {
    const env = await db.environment.findFirst({ where: { id: input.environmentId, applicationId } });
    if (!env) throw badRequest("Environment does not belong to this application.");
  }
  const cases = await db.testCase.findMany({
    where: {
      applicationId,
      archived: false,
      ...(input.include.mode === "cases" ? { id: { in: input.include.testCaseIds } } : {}),
    },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  const selected =
    input.include.mode === "sections"
      ? cases.filter((c) => (input.include as { sections: string[] }).sections.includes(c.versions[0]?.section ?? "(no section)"))
      : cases;
  if (input.include.mode === "cases" && selected.length !== input.include.testCaseIds.length) {
    throw badRequest("Some selected cases do not belong to this application.");
  }
  if (selected.length === 0) throw badRequest("No cases match the selection.");

  return db.$transaction(async (tx) => {
    const cycle = await tx.testCycle.create({
      data: {
        applicationId,
        name: input.name,
        kind: input.kind,
        scope: input.scope || null,
        excludedScope: input.excludedScope || null,
        environmentId: input.environmentId || null,
        buildLabel: input.buildLabel || null,
        createdBy: user,
      },
    });
    await tx.cycleCase.createMany({
      data: selected.map((c, i) => ({
        cycleId: cycle.id,
        testCaseId: c.id,
        caseVersionId: c.versions[0].id,
        sortOrder: i,
      })),
    });
    return cycle;
  });
}

export const updateCycleSchema = z.object({
  scope: z.string().trim().max(4000).nullish(),
  excludedScope: z.string().trim().max(4000).nullish(),
  buildLabel: z.string().trim().max(200).nullish(),
  environmentId: z.string().nullish(),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
});

export async function updateCycle(db: Db, applicationId: string, cycleId: string, input: z.infer<typeof updateCycleSchema>) {
  const cycle = await db.testCycle.findFirst({ where: { id: cycleId, applicationId } });
  if (!cycle) throw notFound("Cycle not found.");
  if (input.environmentId) {
    const env = await db.environment.findFirst({ where: { id: input.environmentId, applicationId } });
    if (!env) throw badRequest("Environment does not belong to this application.");
  }
  return db.testCycle.update({
    where: { id: cycleId },
    data: {
      scope: input.scope === undefined ? undefined : input.scope || null,
      excludedScope: input.excludedScope === undefined ? undefined : input.excludedScope || null,
      buildLabel: input.buildLabel === undefined ? undefined : input.buildLabel || null,
      environmentId: input.environmentId === undefined ? undefined : input.environmentId || null,
      status: input.status,
    },
  });
}

/**
 * Point a cycle assignment at the case's latest version (explicit action).
 * Completed attempts keep the version they used.
 */
export async function adoptLatestVersion(db: Db, cycleCaseId: string) {
  const cc = await db.cycleCase.findUnique({
    where: { id: cycleCaseId },
    include: { attempts: { where: { status: { not: "COMPLETED" } } } },
  });
  if (!cc) throw notFound("Cycle case not found.");
  if (cc.attempts.length) throw conflict("Finish or complete the open attempt before switching versions.");
  const latest = await db.testCaseVersion.findFirstOrThrow({
    where: { testCaseId: cc.testCaseId },
    orderBy: { versionNumber: "desc" },
  });
  return db.cycleCase.update({ where: { id: cc.id }, data: { caseVersionId: latest.id } });
}
