// AI actions. Generation only ever creates AiProposal rows. Cases, findings
// and report summaries change only when a reviewer explicitly accepts an item.

import { z } from "zod";
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { badRequest, conflict, notFound } from "@/server/errors";
import { AiError, aiConfig, extractJson, ollamaChat, type ChatMessage } from "@/server/ai/ollama";
import {
  buildDraftCasesMessages,
  buildReportSummaryMessages,
  buildReviewMessages,
  draftCasesOutputSchema,
  formatZodIssues,
  reportSummaryOutputSchema,
  reviewCaseText,
  reviewOutputSchema,
  validateDraftedCases,
  validateFindings,
  type ContextItem,
  type ReviewCaseInput,
  type ValidatedDraft,
  type ValidatedFinding,
} from "@/lib/ai/schemas";
import { CONTEXT_CATEGORY_LABEL, OUTCOME_LABEL } from "@/lib/domain";
import { formatPercent } from "@/lib/metrics";
import { loadCycleResults } from "@/server/services/results";
import { insertVersion, type CaseContent } from "@/server/services/case-content";
import type { ReportData } from "@/server/services/report-service";

export interface Prepared {
  messages: ChatMessage[];
  /** Plain description shown to the user before generation. */
  submitted: { summary: string; items: string[]; characters: number; model: string; endpointHost: string };
}

function describe(messages: ChatMessage[], summary: string, items: string[]): Prepared {
  const cfg = aiConfig();
  return {
    messages,
    submitted: {
      summary,
      items,
      characters: messages.reduce((n, m) => n + m.content.length, 0),
      model: cfg.model,
      endpointHost: new URL(cfg.url).host,
    },
  };
}

async function callStructured<T>(messages: ChatMessage[], schema: z.ZodType<T>) {
  const res = await ollamaChat(messages, { json: true });
  const json = extractJson(res.content);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AiError("malformed", "The AI response did not match the expected structure. Nothing was saved; try again.", formatZodIssues(parsed.error));
  }
  return { data: parsed.data, model: res.model, durationMs: res.durationMs };
}

// ------------------------------------------------------------------ 1. draft cases

export const draftCasesRequestSchema = z.object({
  requirement: z.string().trim().min(10, "Describe the requirement (at least 10 characters).").max(20000),
  contextEntryIds: z.array(z.string()).max(50).default([]),
  sectionHint: z.string().trim().max(300).nullish(),
  maxCases: z.number().int().min(1).max(15).default(5),
});
export type DraftCasesRequest = z.infer<typeof draftCasesRequestSchema>;

async function contextItems(db: Db, applicationId: string, ids: string[]): Promise<ContextItem[]> {
  if (!ids.length) return [];
  const entries = await db.contextEntry.findMany({ where: { applicationId, id: { in: ids } }, orderBy: { createdAt: "asc" } });
  if (entries.length !== ids.length) throw badRequest("Some selected context entries do not belong to this application.");
  return entries.map((e, i) => ({
    ref: `CTX-${i + 1}`,
    title: e.title,
    category: CONTEXT_CATEGORY_LABEL[e.category],
    status: e.status,
    body: e.body,
  }));
}

export async function prepareDraftCases(db: Db, applicationId: string, req: DraftCasesRequest) {
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
  const ctx = await contextItems(db, applicationId, req.contextEntryIds);
  const messages = buildDraftCasesMessages({
    applicationName: app.name,
    requirement: req.requirement,
    context: ctx,
    sectionHint: req.sectionHint,
    maxCases: req.maxCases,
  });
  const prepared = describe(messages, `Requirement text and ${ctx.length} selected context entr${ctx.length === 1 ? "y" : "ies"}.`, [
    `Requirement (${req.requirement.length} characters)`,
    ...ctx.map((c) => `${c.ref}: ${c.title} [${c.status.toLowerCase()}]`),
  ]);
  return { prepared, ctx };
}

export async function generateDraftCases(db: Db, applicationId: string, req: DraftCasesRequest, user: string) {
  const { prepared, ctx } = await prepareDraftCases(db, applicationId, req);
  const { data, model, durationMs } = await callStructured(prepared.messages, draftCasesOutputSchema);
  const validated = validateDraftedCases(data.cases, ["REQ", ...ctx.map((c) => c.ref)]);
  const refMap = Object.fromEntries([["REQ", "Requirement text supplied by tester"], ...ctx.map((c) => [c.ref, c.title])]);
  return db.aiProposal.create({
    data: {
      applicationId,
      kind: "DRAFT_CASES",
      model,
      durationMs,
      requestedBy: user,
      submittedContext: { ...prepared.submitted, requirement: req.requirement, references: refMap } as Prisma.InputJsonValue,
      output: data as unknown as Prisma.InputJsonValue,
      items: {
        create: validated.map((c, index) => ({
          index,
          originalPayload: c as unknown as Prisma.InputJsonValue,
          payload: c as unknown as Prisma.InputJsonValue,
        })),
      },
    },
    include: { items: true },
  });
}

// ------------------------------------------------------------------ 2. review results

export const reviewRequestSchema = z.object({
  cycleId: z.string(),
  cycleCaseIds: z.array(z.string()).min(1, "Select at least one case.").max(60, "Select at most 60 cases per review."),
});

export async function prepareReview(db: Db, applicationId: string, req: z.infer<typeof reviewRequestSchema>) {
  const cycle = await db.testCycle.findFirst({ where: { id: req.cycleId, applicationId }, include: { application: true } });
  if (!cycle) throw notFound("Cycle not found in this application.");
  const results = await loadCycleResults(db, cycle.id);
  const wanted = new Set(req.cycleCaseIds);
  const rows = results.rows.filter((r) => wanted.has(r.cycleCaseId));
  if (rows.length !== wanted.size) throw badRequest("Some selected cases are not in this cycle.");
  const cases: ReviewCaseInput[] = rows.map((r) => {
    const a = r.latestCompleted;
    return {
      caseId: r.externalId,
      title: r.version.title,
      section: r.section,
      preconditions: r.version.preconditions,
      steps: r.version.stepsText,
      expected: r.version.expectedResult,
      outcome: OUTCOME_LABEL[r.outcome],
      resultSource: a?.source ?? null,
      notes: a?.remarks ?? r.importNotes ?? null,
      reason: a?.outcomeReason ?? null,
      actual: a?.actualResult ?? null,
      partialCoverage: a?.partialCoverage ? (a.partialCoverageNote ?? "yes") : null,
    };
  });
  const messages = buildReviewMessages({ applicationName: cycle.application.name, cycleName: cycle.name, cases });
  const prepared = describe(messages, `${cases.length} selected case(s) from cycle "${cycle.name}": instructions, recorded results and notes. No attachments.`, cases.map((c) => `${c.caseId}: ${c.title} (${c.outcome})`));
  return { prepared, cycle, rows, cases };
}

export async function generateReview(db: Db, applicationId: string, req: z.infer<typeof reviewRequestSchema>, user: string) {
  const { prepared, cycle, rows, cases } = await prepareReview(db, applicationId, req);
  const { data, model, durationMs } = await callStructured(prepared.messages, reviewOutputSchema);
  const submitted = new Map(cases.map((c) => [c.caseId, reviewCaseText(c)]));
  const { findings, droppedCaseIds } = validateFindings(data.findings, submitted);
  const rowByExt = new Map(rows.map((r) => [r.externalId, r]));
  return db.aiProposal.create({
    data: {
      applicationId,
      kind: "REVIEW_RESULTS",
      model,
      durationMs,
      requestedBy: user,
      cycleId: cycle.id,
      submittedContext: { ...prepared.submitted, droppedFindingsForUnknownCases: droppedCaseIds } as Prisma.InputJsonValue,
      output: data as unknown as Prisma.InputJsonValue,
      items: {
        create: findings.map((f, index) => {
          const r = rowByExt.get(f.caseId)!;
          const payload = { ...f, cycleCaseId: r.cycleCaseId, testCaseId: r.testCaseId, attemptId: r.latestCompleted?.id ?? null };
          return { index, originalPayload: payload as Prisma.InputJsonValue, payload: payload as Prisma.InputJsonValue };
        }),
      },
    },
    include: { items: true },
  });
}

// ------------------------------------------------------------------ 3. report summary

function reportSummaryInput(report: { title: string; data: unknown; includedScope: string | null; excludedScope: string | null }) {
  const d = report.data as ReportData;
  const m = d.metrics;
  return buildReportSummaryMessages({
    applicationName: d.application.name,
    cycleName: d.cycle.name,
    buildLabel: d.cycle.buildLabel,
    environment: d.environment?.name ?? null,
    counts: { Pass: m.PASS, Fail: m.FAIL, Blocked: m.BLOCKED, "Not run": m.NOT_RUN, "N/A": m.NOT_APPLICABLE, Total: m.total },
    coverage: formatPercent(m.coverage, "no applicable cases"),
    passRate: formatPercent(m.passRate),
    partialCoverage: m.partialCoverage,
    highPriorityOutstanding: m.highPriorityOutstanding,
    failed: d.cases.filter((c) => c.outcome === "FAIL").map((c) => ({ id: c.externalId, title: c.title, reason: c.reason ?? c.remarks })),
    blocked: d.cases.filter((c) => c.outcome === "BLOCKED").map((c) => ({ id: c.externalId, title: c.title, reason: c.reason ?? c.remarks })),
    incomplete: d.cases
      .filter((c) => c.partialCoverage || c.flags.some((f) => f.type === "INCOMPLETE_TESTING"))
      .map((c) => ({ id: c.externalId, title: c.title, note: c.partialCoverageNote ?? "flagged for review" })),
    includedScope: report.includedScope,
    excludedScope: report.excludedScope,
  });
}

export async function prepareReportSummary(db: Db, applicationId: string, reportId: string) {
  const report = await db.reportSnapshot.findFirst({ where: { id: reportId, cycle: { applicationId } } });
  if (!report) throw notFound("Report not found.");
  const messages = reportSummaryInput(report);
  return {
    report,
    prepared: describe(messages, "Structured counts and the failed/blocked/incomplete case lists from this report snapshot. No evidence files or full case text.", [
      "Outcome counts, coverage and pass rate",
      "Failed, blocked and incomplete-coverage case IDs, titles and recorded reasons",
      "Included / excluded scope",
    ]),
  };
}

export async function generateReportSummary(db: Db, applicationId: string, reportId: string, user: string) {
  const { report, prepared } = await prepareReportSummary(db, applicationId, reportId);
  const { data, model, durationMs } = await callStructured(prepared.messages, reportSummaryOutputSchema);
  const text = [
    data.summary,
    data.highlights.length ? "\nHighlights:\n" + data.highlights.map((h) => `• ${h}`).join("\n") : "",
    data.risks.length ? "\nRisks and open items:\n" + data.risks.map((h) => `• ${h}`).join("\n") : "",
    data.nextSteps.length ? "\nNext steps:\n" + data.nextSteps.map((h) => `• ${h}`).join("\n") : "",
  ]
    .join("")
    .trim();
  return db.aiProposal.create({
    data: {
      applicationId,
      kind: "REPORT_SUMMARY",
      model,
      durationMs,
      requestedBy: user,
      reportId: report.id,
      cycleId: report.cycleId,
      submittedContext: prepared.submitted as Prisma.InputJsonValue,
      output: data as unknown as Prisma.InputJsonValue,
      items: { create: [{ index: 0, originalPayload: { text }, payload: { text } }] },
    },
    include: { items: true },
  });
}

// ------------------------------------------------------------------ review decisions

async function pendingItem(db: Db, applicationId: string, itemId: string) {
  const item = await db.aiProposalItem.findUnique({ where: { id: itemId }, include: { proposal: true } });
  if (!item || item.proposal.applicationId !== applicationId) throw notFound("Proposal item not found.");
  if (item.status !== "PENDING") throw conflict(`This item was already ${item.status.toLowerCase()}.`);
  return item;
}

export async function saveItemEdits(db: Db, applicationId: string, itemId: string, payload: unknown) {
  const item = await pendingItem(db, applicationId, itemId);
  return db.aiProposalItem.update({ where: { id: item.id }, data: { payload: payload as Prisma.InputJsonValue } });
}

export async function rejectItem(db: Db, applicationId: string, itemId: string, note: string | null, user: string) {
  const item = await pendingItem(db, applicationId, itemId);
  return db.aiProposalItem.update({
    where: { id: item.id },
    data: { status: "REJECTED", decidedBy: user, decidedAt: new Date(), decisionNote: note || null },
  });
}

export const acceptDraftSchema = z.object({
  payload: z.object({
    title: z.string().trim().min(1).max(500),
    section: z.string().trim().max(300).default(""),
    role: z.string().trim().max(300).default(""),
    preconditions: z.string().trim().max(5000).default(""),
    steps: z.array(z.object({ text: z.string().trim().min(1), required: z.boolean() })).min(1),
    testData: z.string().trim().max(5000).default(""),
    expectedChecks: z.array(z.string().trim().min(1)).min(1),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
    proposedExecutionMode: z.enum(["MANUAL", "AUTOMATED", "HYBRID"]),
    sourceReferences: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
  }),
  /** Create a new case with this ID, or add a version to an existing case. */
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new"), externalId: z.string().trim().min(1).max(100) }),
    z.object({ kind: z.literal("version"), testCaseId: z.string() }),
  ]),
  note: z.string().trim().max(2000).nullish(),
});

export function draftToContent(p: z.infer<typeof acceptDraftSchema>["payload"]): CaseContent {
  return {
    title: p.title,
    section: p.section || null,
    role: p.role || null,
    environment: null,
    preconditions: p.preconditions || null,
    stepsText: p.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n"),
    steps: p.steps,
    expectedResult: p.expectedChecks.map((c) => `• ${c}`).join("\n"),
    testData: p.testData || null,
    priority: p.priority,
    executionMode: p.proposedExecutionMode,
    categories: [],
    dependsOn: null,
  };
}

export async function acceptDraftCase(db: Db, applicationId: string, itemId: string, input: z.infer<typeof acceptDraftSchema>, user: string) {
  const item = await pendingItem(db, applicationId, itemId);
  if (item.proposal.kind !== "DRAFT_CASES") throw badRequest("Not a drafted case.");
  const content = draftToContent(input.payload);
  const refs = (item.proposal.submittedContext as { references?: Record<string, string> }).references ?? {};
  const changeNote = [
    `Accepted from AI proposal (${item.proposal.model}) by ${user}.`,
    input.payload.sourceReferences.length
      ? `Sources: ${input.payload.sourceReferences.map((r) => `${r} = ${refs[r] ?? "?"}`).join("; ")}.`
      : "No source references.",
    input.payload.assumptions.length ? `Assumptions: ${input.payload.assumptions.join(" | ")}` : "",
    input.payload.openQuestions.length ? `Open questions: ${input.payload.openQuestions.join(" | ")}` : "",
    input.note ? `Reviewer note: ${input.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return db.$transaction(async (tx) => {
    let testCaseId: string;
    if (input.target.kind === "new") {
      const clash = await tx.testCase.findFirst({
        where: { applicationId, externalId: { equals: input.target.externalId, mode: "insensitive" } },
      });
      if (clash) throw conflict(`Case ID ${input.target.externalId} already exists. Choose another ID or add a version to it.`);
      const tc = await tx.testCase.create({
        data: { applicationId, externalId: input.target.externalId, origin: "AI_PROPOSAL", createdBy: user },
      });
      testCaseId = tc.id;
    } else {
      const tc = await tx.testCase.findFirst({ where: { id: input.target.testCaseId, applicationId } });
      if (!tc) throw notFound("Target case not found in this application.");
      testCaseId = tc.id;
    }
    const version = await insertVersion(tx, testCaseId, content, {
      source: "AI_PROPOSAL",
      createdBy: user,
      changeNote,
      aiProposalItemId: item.id,
    });
    await tx.aiProposalItem.update({
      where: { id: item.id },
      data: {
        status: "ACCEPTED",
        payload: input.payload as Prisma.InputJsonValue,
        decidedBy: user,
        decidedAt: new Date(),
        decisionNote: input.note || null,
      },
    });
    return { testCaseId, version };
  });
}

export const acceptFindingSchema = z.object({
  type: z.enum(["APPLICATION_FAILURE", "BLOCKED_OR_SETUP", "INCOMPLETE_TESTING", "AMBIGUOUS_OR_OUTDATED"]),
  summary: z.string().trim().min(1).max(2000),
  note: z.string().trim().max(2000).nullish(),
});

/** Accepting a finding records a review flag. It never changes a result. */
export async function acceptFinding(db: Db, applicationId: string, itemId: string, input: z.infer<typeof acceptFindingSchema>, user: string) {
  const item = await pendingItem(db, applicationId, itemId);
  if (item.proposal.kind !== "REVIEW_RESULTS") throw badRequest("Not a review finding.");
  const p = item.payload as unknown as ValidatedFinding & { cycleCaseId: string; testCaseId: string; attemptId: string | null };
  return db.$transaction(async (tx) => {
    const finding = await tx.finding.create({
      data: {
        applicationId,
        testCaseId: p.testCaseId,
        cycleCaseId: p.cycleCaseId,
        attemptId: p.attemptId,
        type: input.type,
        source: "AI_REVIEW",
        message: input.summary,
        evidenceExcerpt: p.evidenceQuote || null,
        aiProposalItemId: item.id,
        createdBy: user,
      },
    });
    await tx.aiProposalItem.update({
      where: { id: item.id },
      data: {
        status: "ACCEPTED",
        payload: { ...p, type: input.type, summary: input.summary } as Prisma.InputJsonValue,
        decidedBy: user,
        decidedAt: new Date(),
        decisionNote: input.note || null,
      },
    });
    return finding;
  });
}

export async function acceptReportSummary(db: Db, applicationId: string, itemId: string, text: string, user: string) {
  const item = await pendingItem(db, applicationId, itemId);
  if (item.proposal.kind !== "REPORT_SUMMARY" || !item.proposal.reportId) throw badRequest("Not a report summary.");
  if (!text.trim()) throw badRequest("Summary text is empty.");
  return db.$transaction(async (tx) => {
    await tx.reportSnapshot.update({
      where: { id: item.proposal.reportId! },
      data: { aiSummary: text.trim(), aiSummaryReviewed: true, aiSummaryReviewedBy: user, aiProposalId: item.proposalId },
    });
    return tx.aiProposalItem.update({
      where: { id: item.id },
      data: { status: "ACCEPTED", payload: { text: text.trim() }, decidedBy: user, decidedAt: new Date() },
    });
  });
}

export async function testConnection() {
  const cfg = aiConfig();
  const started = Date.now();
  const res = await ollamaChat(
    [
      { role: "system", content: 'Reply with the JSON object {"ok": true} and nothing else.' },
      { role: "user", content: "Connection test." },
    ],
    { json: true, timeoutMs: Math.min(cfg.timeoutMs, 60_000) },
  );
  let validJson = false;
  try {
    validJson = (extractJson(res.content) as { ok?: unknown })?.ok === true;
  } catch {
    validJson = false;
  }
  return { ok: true, model: res.model, configuredModel: cfg.model, latencyMs: Date.now() - started, structuredOutputOk: validJson };
}

export type { ValidatedDraft };
