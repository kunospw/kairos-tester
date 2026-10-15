// Manual / hybrid execution recording.
// - One open (unfinished) attempt per cycle case; opening again resumes it.
// - Completed attempts are immutable. Retesting starts a new attempt.
// - Attempts always carry the case version they were executed against.

import { z } from "zod";
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { badRequest, conflict, notFound } from "@/server/errors";
import { validateCompletion } from "@/lib/execution-rules";
import { isoDateToDbDate, todayIso } from "@/lib/dates";
import type { ExecutionModeValue } from "@/lib/domain";

const stepResult = z.enum(["PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE", "NOT_RUN"]);

export const attemptUpdateSchema = z.object({
  status: z.enum(["DRAFT", "RUNNING", "AWAITING_REVIEW"]).optional(),
  outcome: z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE"]).nullish(),
  outcomeReason: z.string().max(10000).nullish(),
  actualResult: z.string().max(20000).nullish(),
  remarks: z.string().max(20000).nullish(),
  partialCoverage: z.boolean().optional(),
  partialCoverageNote: z.string().max(5000).nullish(),
  tester: z.string().trim().max(200).nullish(),
  executionMethod: z.enum(["MANUAL", "HYBRID"]).optional(),
  humanCheckpointConfirmed: z.boolean().optional(),
  steps: z
    .array(z.object({ stepIndex: z.number().int().min(0), result: stepResult, note: z.string().max(5000).nullish() }))
    .optional(),
});
export type AttemptUpdate = z.infer<typeof attemptUpdateSchema>;

async function loadCycleCase(db: Db, cycleCaseId: string) {
  const cc = await db.cycleCase.findUnique({
    where: { id: cycleCaseId },
    include: { cycle: true, caseVersion: true },
  });
  if (!cc) throw notFound("Cycle case not found.");
  return cc;
}

/** Resume the open attempt, or start a new one (a retest if earlier attempts exist). */
export async function startOrResumeAttempt(db: Db, cycleCaseId: string, tester: string) {
  const cc = await loadCycleCase(db, cycleCaseId);
  if (cc.cycle.status === "CLOSED") throw conflict("This cycle is closed.");
  const open = await db.executionAttempt.findFirst({
    where: { cycleCaseId, status: { not: "COMPLETED" } },
    orderBy: { attemptNumber: "desc" },
  });
  if (open) return { attempt: open, resumed: true };

  const simulation = cc.cycle.kind === "SIMULATION";
  return db.$transaction(async (tx) => {
    const last = await tx.executionAttempt.findFirst({
      where: { cycleCaseId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    const steps = (cc.caseVersion.steps as { text: string; required: boolean }[] | null) ?? [];
    const attempt = await tx.executionAttempt.create({
      data: {
        cycleCaseId,
        caseVersionId: cc.caseVersionId,
        attemptNumber: (last?.attemptNumber ?? 0) + 1,
        status: "DRAFT",
        source: simulation ? "SIMULATION" : "MANUAL",
        isSimulated: simulation,
        executionMethod: cc.caseVersion.executionMode === "HYBRID" ? "HYBRID" : "MANUAL",
        buildLabel: cc.cycle.buildLabel,
        tester,
        startedAt: new Date(),
        stepOutcomes: {
          create: steps.map((s, i) => ({ stepIndex: i, stepText: s.text, required: s.required !== false })),
        },
      },
    });
    return { attempt, resumed: false };
  });
}

async function loadOpenAttempt(db: Db, attemptId: string) {
  const a = await db.executionAttempt.findUnique({
    where: { id: attemptId },
    include: { stepOutcomes: { orderBy: { stepIndex: "asc" } }, caseVersion: true, cycleCase: { include: { cycle: true } } },
  });
  if (!a) throw notFound("Attempt not found.");
  if (a.status === "COMPLETED") throw conflict("This attempt is completed and cannot be changed. Start a retest instead.");
  if (a.cycleCase.cycle.status === "CLOSED") throw conflict("This cycle is closed.");
  return a;
}

function updateData(input: AttemptUpdate): Prisma.ExecutionAttemptUpdateInput {
  return {
    status: input.status,
    outcome: input.outcome === undefined ? undefined : input.outcome,
    outcomeReason: input.outcomeReason === undefined ? undefined : input.outcomeReason?.trim() || null,
    actualResult: input.actualResult === undefined ? undefined : input.actualResult?.trim() || null,
    remarks: input.remarks === undefined ? undefined : input.remarks?.trim() || null,
    partialCoverage: input.partialCoverage,
    partialCoverageNote: input.partialCoverageNote === undefined ? undefined : input.partialCoverageNote?.trim() || null,
    tester: input.tester === undefined ? undefined : input.tester || null,
    executionMethod: input.executionMethod,
  };
}

async function writeSteps(db: Db, attemptId: string, steps: AttemptUpdate["steps"]) {
  if (!steps) return;
  for (const s of steps) {
    await db.stepOutcome.updateMany({
      where: { attemptId, stepIndex: s.stepIndex },
      data: { result: s.result, note: s.note?.trim() || null },
    });
  }
}

/** Save progress without completing (draft / running / awaiting review). */
export async function saveAttemptDraft(db: Db, attemptId: string, input: AttemptUpdate) {
  await loadOpenAttempt(db, attemptId);
  const a = await db.executionAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { executionMethod: true } });
  await writeSteps(db, attemptId, input.steps);
  const data = updateData(input);
  if (a.executionMethod === "AI_DRIVEN") delete data.executionMethod;
  return db.executionAttempt.update({ where: { id: attemptId }, data });
}

/** Validate and complete. Returns validation errors instead of throwing for rule failures. */
export async function completeAttempt(db: Db, attemptId: string, input: AttemptUpdate, user: string) {
  const a = await loadOpenAttempt(db, attemptId);
  await writeSteps(db, attemptId, input.steps);
  const steps = await db.stepOutcome.findMany({ where: { attemptId }, orderBy: { stepIndex: "asc" } });

  const outcome = input.outcome ?? a.outcome;
  if (!outcome) throw badRequest("Choose a result before completing.");
  const aiDriven = a.executionMethod === "AI_DRIVEN";
  if (aiDriven) input = { ...input, executionMethod: undefined };
  const method = input.executionMethod ?? a.executionMethod;
  // AI-driven attempts are treated like hybrid: a human must confirm before completion.
  const mode: ExecutionModeValue =
    aiDriven || a.caseVersion.executionMode === "HYBRID" || method === "HYBRID" ? "HYBRID" : (a.caseVersion.executionMode as ExecutionModeValue);
  const tester = input.tester ?? a.tester;
  const errors = validateCompletion({
    outcome,
    outcomeReason: input.outcomeReason ?? a.outcomeReason,
    steps: steps.map((s) => ({ text: s.stepText, required: s.required, result: s.result })),
    partialCoverage: input.partialCoverage ?? a.partialCoverage,
    partialCoverageNote: input.partialCoverageNote ?? a.partialCoverageNote,
    executionMode: mode,
    humanCheckpointConfirmed: Boolean(input.humanCheckpointConfirmed),
    tester,
  });
  if (errors.length) {
    // Persist what the tester entered so nothing is lost, then report.
    await db.executionAttempt.update({ where: { id: attemptId }, data: updateData({ ...input, status: undefined }) });
    throw badRequest("Cannot complete this attempt yet.", errors);
  }
  const done = await db.executionAttempt.update({
    where: { id: attemptId },
    data: {
      ...updateData({ ...input, status: undefined }),
      outcome,
      status: "COMPLETED",
      completedAt: new Date(),
      executedOn: isoDateToDbDate(todayIso()),
      ...(mode === "HYBRID" ? { humanCheckpointBy: user, humanCheckpointAt: new Date() } : {}),
    },
  });
  // If an AI run handed this case to a person, a result recorded anywhere (attempt page or
  // the "Needs you" inbox) closes that request, so it is never asked twice.
  const waiting = await db.runItem.findMany({ where: { cycleCaseId: a.cycleCaseId, status: "NEEDS_HUMAN" } });
  for (const it of waiting) {
    await db.humanRequest.updateMany({
      where: { runItemId: it.id, status: "OPEN", kind: { in: ["MANUAL_CASE", "RUN_ERROR", "CONFIRM_RESULT"] } },
      data: { status: "ANSWERED", answer: "Decided outside the run page", answeredBy: user, answeredAt: new Date() },
    });
    if ((await db.humanRequest.count({ where: { runItemId: it.id, status: "OPEN" } })) === 0) {
      await db.runItem.update({ where: { id: it.id }, data: { status: "DONE", attemptId, statusNote: `Done by ${user}.` } });
    }
  }
  return done;
}

export const agentRunSchema = z.object({
  agentLabel: z.string().trim().min(1).max(200),
  proposedOutcome: z.enum(["PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"]),
  proposedReason: z.string().trim().max(10000).nullish(),
  actualResult: z.string().trim().min(1, "Describe what the agent observed.").max(20000),
  remarks: z.string().trim().max(20000).nullish(),
  partialCoverage: z.boolean().default(false),
  partialCoverageNote: z.string().trim().max(5000).nullish(),
  steps: z
    .array(z.object({ stepIndex: z.number().int().min(0), result: stepResult, note: z.string().max(5000).nullish() }))
    .default([]),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

/**
 * Record an attempt performed by an AI agent (e.g. Claude driving Playwright).
 * It always lands in AWAITING_REVIEW with the agent's verdict only as
 * `proposedOutcome`; a person reviews the evidence and completes it.
 */
export async function recordAgentRun(db: Db, cycleCaseId: string, input: AgentRun, user: string) {
  const cc = await loadCycleCase(db, cycleCaseId);
  if (cc.cycle.status === "CLOSED") throw conflict("This cycle is closed.");
  if (cc.cycle.kind === "HISTORICAL_IMPORT") throw badRequest("Record new runs in a test cycle, not in an imported historical cycle.");
  const open = await db.executionAttempt.findFirst({ where: { cycleCaseId, status: { not: "COMPLETED" } } });
  if (open) throw conflict(`Attempt ${open.attemptNumber} is still open for this case. Finish or discard it first.`);
  if (input.partialCoverage && !input.partialCoverageNote) throw badRequest("Explain what the agent did not cover.");
  const versionSteps = (cc.caseVersion.steps as { text: string; required: boolean }[] | null) ?? [];
  const byIndex = new Map(input.steps.map((s) => [s.stepIndex, s]));
  for (const s of input.steps) {
    if (s.stepIndex >= versionSteps.length) throw badRequest(`Step ${s.stepIndex + 1} does not exist in case version ${cc.caseVersion.versionNumber}.`);
  }
  const simulation = cc.cycle.kind === "SIMULATION";
  return db.$transaction(async (tx) => {
    const last = await tx.executionAttempt.findFirst({
      where: { cycleCaseId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    return tx.executionAttempt.create({
      data: {
        cycleCaseId,
        caseVersionId: cc.caseVersionId,
        attemptNumber: (last?.attemptNumber ?? 0) + 1,
        status: "AWAITING_REVIEW",
        outcome: null,
        proposedOutcome: input.proposedOutcome,
        outcomeReason: input.proposedReason || null,
        actualResult: input.actualResult,
        remarks: [input.remarks, `Run by ${input.agentLabel}, requested by ${user}. Outcome not decided: awaiting human review.`]
          .filter(Boolean)
          .join("\n"),
        partialCoverage: input.partialCoverage,
        partialCoverageNote: input.partialCoverageNote || null,
        tester: input.agentLabel,
        agentLabel: input.agentLabel,
        executionMethod: "AI_DRIVEN",
        source: simulation ? "SIMULATION" : "AI_AGENT",
        isSimulated: simulation,
        buildLabel: cc.cycle.buildLabel,
        startedAt: new Date(),
        stepOutcomes: {
          create: versionSteps.map((s, i) => ({
            stepIndex: i,
            stepText: s.text,
            required: s.required !== false,
            result: byIndex.get(i)?.result ?? "NOT_RUN",
            note: byIndex.get(i)?.note?.trim() || null,
          })),
        },
      },
    });
  });
}

/** Discard an unfinished attempt that has no evidence (e.g. opened by mistake). */
export async function discardDraft(db: Db, attemptId: string) {
  const a = await loadOpenAttempt(db, attemptId);
  const evidence = await db.evidence.count({ where: { attemptId } });
  if (evidence > 0) throw conflict("This draft has evidence attached; it cannot be discarded.");
  await db.executionAttempt.delete({ where: { id: a.id } });
}
