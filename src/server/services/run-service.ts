// AI test runs: plan -> start -> runner executes -> people answer only what needs them.
import { ACTIONS_PREFIX } from "@/lib/recipes";
import { z } from "zod";
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { badRequest, conflict, notFound } from "@/server/errors";
import { parseProfile, type AgentProfile } from "@/lib/agent-profile";
import { planCase, dependenciesOf, changesSharedData, type Plan } from "@/lib/run-planning";
import { decide, type CheckRecord, type StepRecord } from "@/lib/agent-protocol";
import { isoDateToDbDate, todayIso } from "@/lib/dates";
import { completeAttempt } from "@/server/services/execution-service";
import { aiConfig, ollamaChat, extractJson } from "@/server/ai/ollama";
import { getEvidenceStorage } from "@/server/storage/evidence-storage";
import { runnerStatus } from "@/server/services/attention-service";
import { RECHECK_PREFIX, dependencyState, personAskedToRecheck, releaseWaiting } from "@/server/services/run-waiting";

// ------------------------------------------------------------------ planning

export const runScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("not_passed_last") }),
  z.object({ mode: z.literal("sections"), sections: z.array(z.string()).min(1) }),
  z.object({ mode: z.literal("cases"), testCaseIds: z.array(z.string()).min(1) }),
  /** Pick up an existing round (e.g. an imported checklist): only cases without a result yet. */
  z.object({
    mode: z.literal("continue_cycle"),
    cycleId: z.string().min(1),
    includeBlocked: z.boolean().default(false),
    includeFailed: z.boolean().default(false),
    /** First re-run earlier passed cases (as setup) to rebuild the data later cases need. */
    withSetup: z.boolean().default(false),
  }),
]);

export const startRunSchema = z.object({
  environmentId: z.string().min(1),
  buildLabel: z.string().trim().max(200).nullish(),
  scope: runScopeSchema,
});

export interface PlannedCase {
  testCaseId: string;
  externalId: string;
  title: string;
  section: string | null;
  plan: Plan;
  reason: string | null;
  stepsText: string | null;
  /** Set when continuing an existing cycle: the assignment to run. */
  cycleCaseId?: string;
  /** Result already recorded in that cycle, if any (Blocked/Fail retests). */
  previous?: string | null;
  /** SETUP = re-run of an earlier passed case to rebuild data; its result goes to a setup cycle. */
  purpose?: "TEST" | "SETUP";
  /** Case version to use (the one assigned in the round being continued). */
  versionId?: string;
  /** Checklist position, used to interleave setup and test cases. */
  order?: number;
}

/** Cases in an existing cycle that still need doing, at the version assigned in that cycle. */
async function unfinishedInCycle(db: Db, applicationId: string, scope: { cycleId: string; includeBlocked: boolean; includeFailed: boolean }) {
  const cycle = await db.testCycle.findFirst({ where: { id: scope.cycleId, applicationId } });
  if (!cycle) throw notFound("Cycle not found in this application.");
  if (cycle.kind === "SIMULATION") throw badRequest("Simulation cycles cannot be continued with real runs.");
  if (cycle.status === "CLOSED") throw badRequest("This cycle is closed. Reopen it first.");
  const ccs = await db.cycleCase.findMany({
    where: { cycleId: cycle.id },
    orderBy: { sortOrder: "asc" },
    include: {
      testCase: true,
      caseVersion: true,
      attempts: { orderBy: { attemptNumber: "desc" } },
      runItems: { where: { status: { in: ["QUEUED", "RUNNING", "NEEDS_HUMAN"] }, run: { status: "RUNNING" } }, select: { id: true } },
    },
  });
  return ccs.filter((cc) => {
    if (cc.attempts.some((a) => a.status !== "COMPLETED")) return false; // someone is already on it
    if (cc.runItems.length) return false; // already queued in an active run
    const last = cc.attempts.find((a) => a.status === "COMPLETED")?.outcome ?? null;
    return last === null || (scope.includeBlocked && last === "BLOCKED") || (scope.includeFailed && last === "FAIL");
  });
}

/**
 * Ask the model which earlier cases build the data the unfinished cases need.
 * Only IDs from the candidate list are accepted; on any problem, fall back to all candidates.
 */
const setupCache = new Map<string, { at: number; value: { ids: Set<string>; how: string } }>();

export async function chooseSetup(
  tests: { externalId: string; title: string; preconditions: string | null; stepsText: string | null }[],
  candidates: { externalId: string; title: string; section: string | null; preconditions: string | null }[],
): Promise<{ ids: Set<string>; how: string }> {
  const valid = new Set(candidates.map((c) => c.externalId));
  const all = { ids: new Set(valid), how: "all earlier passed cases" };
  if (!aiConfig().keyConfigured || !candidates.length || !tests.length) return all;

  // The start screen previews often; the model takes about a minute, so cache per selection.
  const key = JSON.stringify([tests.map((t) => t.externalId), [...valid]]);
  const hit = setupCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;

  const short = (x: string | null, n: number) => (x ?? "").replace(/\s+/g, " ").slice(0, n);
  const prompt = `These test cases still need to be run, on a FRESH copy of the application that only has its demo seed data:
${tests.map((t) => `- ${t.externalId} ${t.title} | needs: ${short(t.preconditions, 140) || "nothing stated"}`).join("\n")}

These earlier cases passed before and can be re-run to create data (uploaded files, mappings, approvals, loads, settings):
${candidates.map((c) => `- ${c.externalId} [${short(c.section, 40)}] ${c.title}`).join("\n")}

Choose the SMALLEST set of earlier cases that must be re-run so the remaining cases' preconditions are met, including what those cases themselves need first. Skip cases that only view or check things. Prefer the basic case that creates data (e.g. a normal upload) over variants that test unusual files or edge cases.
Reply with JSON only: {"setup": ["<case id>", ...], "why": "<one sentence>"}`;
  let value = all;
  try {
    const res = await ollamaChat([{ role: "user", content: prompt }], { json: true, timeoutMs: 180_000 });
    const out = z.object({ setup: z.array(z.string()), why: z.string().default("") }).parse(extractJson(res.content));
    const ids = new Set(out.setup.map((x) => x.trim()).filter((x) => valid.has(x)));
    if (ids.size) value = { ids, how: `chosen by the AI: ${out.why}`.slice(0, 400) };
  } catch {
    value = all;
  }
  // Safety net: add every earlier case named explicitly in a precondition ("LD-03 done"), transitively.
  const byId = new Map(candidates.map((c) => [c.externalId, c]));
  const queue = [...tests.map((t) => t.preconditions), ...[...value.ids].map((id) => byId.get(id)?.preconditions ?? null)];
  while (queue.length) {
    for (const dep of dependenciesOf(queue.shift() ?? null, "")) {
      if (valid.has(dep) && !value.ids.has(dep)) {
        value.ids.add(dep);
        queue.push(byId.get(dep)?.preconditions ?? null);
      }
    }
  }
  setupCache.set(key, { at: Date.now(), value });
  return value;
}

async function loadEnvironment(db: Db, applicationId: string, environmentId: string) {
  const env = await db.environment.findFirst({ where: { id: environmentId, applicationId } });
  if (!env) throw notFound("Environment not found in this application.");
  const profile = parseProfile(env.agentProfile);
  return { env, profile };
}

/** Latest real cycle (by creation) that has at least one completed result. */
async function lastResultsByCase(db: Db, applicationId: string) {
  const attempts = await db.executionAttempt.findMany({
    where: { status: "COMPLETED", isSimulated: false, cycleCase: { cycle: { applicationId, kind: { not: "SIMULATION" } } } },
    orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { executedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { outcome: true, cycleCase: { select: { testCaseId: true } } },
  });
  const latest = new Map<string, string>();
  for (const a of attempts) if (!latest.has(a.cycleCase.testCaseId)) latest.set(a.cycleCase.testCaseId, a.outcome ?? "NOT_RUN");
  return latest;
}

export async function planRun(db: Db, applicationId: string, input: z.infer<typeof startRunSchema>): Promise<{ profile: AgentProfile | null; cases: PlannedCase[] }> {
  const { env, profile } = await loadEnvironment(db, applicationId, input.environmentId);
  const ctx = {
    reachableEnvironments: profile?.caseEnvironments ?? [],
    disposable: env.disposable,
    codesWithoutInbox: profile?.signIn.method === "email_code_outbox",
    readOnly: profile?.readOnly ?? false,
  };
  const planOne = (externalId: string, v: { title: string; environment: string | null; preconditions: string | null; stepsText: string | null; expectedResult: string | null; testData?: string | null }) =>
    profile
      ? planCase({ externalId, title: v.title, environment: v.environment, preconditions: v.preconditions, stepsText: v.stepsText, expectedResult: v.expectedResult, testData: v.testData }, ctx)
      : { plan: "NEEDS_HUMAN" as Plan, reason: "This environment is not set up for the AI runner yet." };

  if (input.scope.mode === "continue_cycle") {
    const ccs = await unfinishedInCycle(db, applicationId, input.scope);
    const tests: PlannedCase[] = ccs.map((cc) => {
      const p = planOne(cc.testCase.externalId, cc.caseVersion);
      return {
        testCaseId: cc.testCaseId,
        externalId: cc.testCase.externalId,
        title: cc.caseVersion.title,
        section: cc.caseVersion.section,
        plan: p.plan,
        reason: p.reason,
        stepsText: cc.caseVersion.stepsText,
        cycleCaseId: cc.id,
        previous: cc.attempts.find((a) => a.status === "COMPLETED")?.outcome ?? null,
        purpose: "TEST",
        versionId: cc.caseVersionId,
        order: cc.sortOrder,
      };
    });
    if (!input.scope.withSetup) return { profile, cases: tests };

    // Setup: earlier cases that passed in this round, that the AI can run and that don't
    // delete anything, up to the last unfinished case the AI will run.
    const lastNeeded = Math.max(-1, ...tests.filter((t) => t.plan === "AUTOMATABLE").map((t) => t.order!));
    const wanted = new Set(tests.map((t) => t.cycleCaseId));
    const all = await db.cycleCase.findMany({
      where: { cycleId: input.scope.cycleId, sortOrder: { lt: lastNeeded } },
      orderBy: { sortOrder: "asc" },
      include: { testCase: true, caseVersion: true, attempts: { where: { status: "COMPLETED" }, orderBy: { attemptNumber: "desc" }, take: 1 } },
    });
    const eligible = all.filter((cc) => {
      if (wanted.has(cc.id) || cc.attempts[0]?.outcome !== "PASS") return false;
      return planOne(cc.testCase.externalId, cc.caseVersion).plan === "AUTOMATABLE" && !changesSharedData(cc.caseVersion);
    });
    const chosen = await chooseSetup(
      ccs.filter((cc) => tests.find((t) => t.cycleCaseId === cc.id)?.plan === "AUTOMATABLE").map((cc) => ({
        externalId: cc.testCase.externalId,
        title: cc.caseVersion.title,
        preconditions: cc.caseVersion.preconditions,
        stepsText: cc.caseVersion.stepsText,
      })),
      eligible.map((cc) => ({ externalId: cc.testCase.externalId, title: cc.caseVersion.title, section: cc.caseVersion.section, preconditions: cc.caseVersion.preconditions })),
    );
    const setup: PlannedCase[] = [];
    for (const cc of eligible) {
      if (!chosen.ids.has(cc.testCase.externalId)) continue;
      setup.push({
        testCaseId: cc.testCaseId,
        externalId: cc.testCase.externalId,
        title: cc.caseVersion.title,
        section: cc.caseVersion.section,
        plan: "AUTOMATABLE",
        reason: `Setup (${chosen.how})`,
        stepsText: cc.caseVersion.stepsText,
        purpose: "SETUP",
        versionId: cc.caseVersionId,
        order: cc.sortOrder,
      });
    }
    return { profile, cases: [...setup, ...tests].sort((a, b) => a.order! - b.order!) };
  }

  const cases = await db.testCase.findMany({
    where: { applicationId, archived: false, ...(input.scope.mode === "cases" ? { id: { in: input.scope.testCaseIds } } : {}) },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  let selected = cases;
  if (input.scope.mode === "sections") {
    const wanted = input.scope.sections;
    selected = cases.filter((c) => wanted.includes(c.versions[0].section ?? "(no section)"));
  } else if (input.scope.mode === "not_passed_last") {
    const last = await lastResultsByCase(db, applicationId);
    selected = cases.filter((c) => last.get(c.id) !== "PASS" && last.get(c.id) !== "NOT_APPLICABLE");
  }
  return {
    profile,
    cases: selected.map((c) => {
      const v = c.versions[0];
      const p = planOne(c.externalId, v);
      return { testCaseId: c.id, externalId: c.externalId, title: v.title, section: v.section, plan: p.plan, reason: p.reason, stepsText: v.stepsText };
    }),
  };
}

export async function startRun(db: Db, applicationId: string, input: z.infer<typeof startRunSchema>, user: string) {
  const { env, profile } = await loadEnvironment(db, applicationId, input.environmentId);
  if (!profile) throw badRequest("Set up this environment for the AI runner first (Setup → Environments).");
  const { cases } = await planRun(db, applicationId, input);
  if (!cases.length) throw badRequest("No cases match this selection.");
  const stamp = new Date().toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  // Cases that remove/archive/delete run after everything else, so they can't break shared test data.
  const risky = new Set(cases.filter((c) => changesSharedData({ title: c.title, stepsText: c.stepsText, expectedResult: null })).map((c) => c.testCaseId));
  cases.sort((a, b) => Number(risky.has(a.testCaseId)) - Number(risky.has(b.testCaseId)));
  const automatable = cases.filter((c) => c.plan === "AUTOMATABLE").length;

  if (input.scope.mode === "continue_cycle") {
    // Test results go into the existing round next to what is already recorded there.
    // Setup re-runs go into their own cycle so they never change the round's results.
    const cycleId = input.scope.cycleId;
    const setupCount = cases.filter((c) => c.purpose === "SETUP").length;
    return db.$transaction(async (tx) => {
      const run = await tx.testRun.create({ data: { cycleId, environmentId: env.id, model: aiConfig().model, startedBy: user } });
      let setupCycleId: string | null = null;
      if (setupCount) {
        const round = await tx.testCycle.findUniqueOrThrow({ where: { id: cycleId } });
        const sc = await tx.testCycle.create({
          data: {
            applicationId,
            name: `AI setup · ${stamp} · ${env.name}`,
            kind: "STANDARD",
            environmentId: env.id,
            buildLabel: input.buildLabel || null,
            scope: `Setup re-runs of ${setupCount} earlier case(s), to rebuild the data needed to continue "${round.name}". Results here do not change that round.`,
            createdBy: user,
          },
        });
        setupCycleId = sc.id;
      }
      for (const [i, c] of cases.entries()) {
        let cycleCaseId = c.cycleCaseId;
        if (c.purpose === "SETUP") {
          const cc = await tx.cycleCase.create({ data: { cycleId: setupCycleId!, testCaseId: c.testCaseId, caseVersionId: c.versionId!, sortOrder: i } });
          cycleCaseId = cc.id;
        }
        const item = await tx.runItem.create({
          data: {
            runId: run.id,
            cycleCaseId: cycleCaseId!,
            purpose: c.purpose ?? "TEST",
            sortOrder: i,
            plan: c.plan,
            planReason: c.reason,
            status: c.plan === "AUTOMATABLE" ? "QUEUED" : c.plan === "NEEDS_HUMAN" ? "NEEDS_HUMAN" : "SKIPPED",
            statusNote: c.reason,
          },
        });
        if (c.plan === "NEEDS_HUMAN") {
          await tx.humanRequest.create({ data: { runItemId: item.id, kind: "MANUAL_CASE", question: `${c.externalId} needs you: ${c.reason}`, detail: c.title } });
        }
      }
      await tx.runEvent.create({
        data: {
          runId: run.id,
          message: `Continuing an existing round, started by ${user}: ${cases.length - setupCount} unfinished case(s)${setupCount ? ` after ${setupCount} setup re-run(s)` : ""} (${automatable} for the AI in total). Earlier results are kept.`,
        },
      });
      return run;
    });
  }

  return db.$transaction(async (tx) => {
    const cycle = await tx.testCycle.create({
      data: {
        applicationId,
        name: `AI run · ${stamp} · ${env.name}`,
        kind: "STANDARD",
        environmentId: env.id,
        buildLabel: input.buildLabel || null,
        scope: `AI-driven run of ${cases.length} case(s) on ${env.name}.`,
        createdBy: user,
      },
    });
    const versions = await tx.testCaseVersion.findMany({
      where: { testCaseId: { in: cases.map((c) => c.testCaseId) } },
      orderBy: { versionNumber: "desc" },
      distinct: ["testCaseId"],
    });
    const vByCase = new Map(versions.map((v) => [v.testCaseId, v.id]));
    const run = await tx.testRun.create({
      data: { cycleId: cycle.id, environmentId: env.id, model: aiConfig().model, startedBy: user },
    });
    for (const [i, c] of cases.entries()) {
      const cc = await tx.cycleCase.create({ data: { cycleId: cycle.id, testCaseId: c.testCaseId, caseVersionId: vByCase.get(c.testCaseId)!, sortOrder: i } });
      const item = await tx.runItem.create({
        data: {
          runId: run.id,
          cycleCaseId: cc.id,
          sortOrder: i,
          plan: c.plan,
          planReason: c.reason,
          status: c.plan === "AUTOMATABLE" ? "QUEUED" : c.plan === "NEEDS_HUMAN" ? "NEEDS_HUMAN" : "SKIPPED",
          statusNote: c.reason,
        },
      });
      if (c.plan === "NEEDS_HUMAN") {
        await tx.humanRequest.create({
          data: { runItemId: item.id, kind: "MANUAL_CASE", question: `${c.externalId} needs you: ${c.reason}`, detail: c.title },
        });
      }
    }
    await tx.runEvent.create({ data: { runId: run.id, message: `Run started by ${user}: ${cases.length} cases (${cases.filter((c) => c.plan === "AUTOMATABLE").length} for the AI).` } });
    return run;
  });
}

// ------------------------------------------------------------------ live view

/** `focusItemId` pins the step log to one case; by default it follows the case running now. */
export async function runView(db: Db, applicationId: string, runId: string, focusItemId?: string | null) {
  const run = await db.testRun.findFirst({
    where: { id: runId, cycle: { applicationId } },
    include: {
      environment: true,
      cycle: true,
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          cycleCase: { include: { testCase: true, caseVersion: true } },
          attempt: { include: { evidence: { select: { id: true, caption: true, mimeType: true }, orderBy: { createdAt: "asc" } } } },
          requests: { orderBy: { createdAt: "asc" } },
        },
      },
      events: { where: { NOT: { message: { startsWith: ACTIONS_PREFIX } } }, orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!run) throw notFound("Run not found.");
  const runnerOnline = (await runnerStatus(db)).online;

  const items = run.items.map((it) => {
    const a = it.attempt;
    const result = a?.status === "COMPLETED" ? a.outcome : null;
    const verifiedBy = a?.status === "COMPLETED" ? (a.executionMethod === "AI_DRIVEN" && !a.humanCheckpointBy ? "AI" : (a.humanCheckpointBy ?? a.tester ?? "person")) : null;
    return {
      id: it.id,
      cycleCaseId: it.cycleCaseId,
      cycleId: it.cycleCase.cycleId,
      purpose: it.purpose,
      externalId: it.cycleCase.testCase.externalId,
      title: it.cycleCase.caseVersion.title,
      section: it.cycleCase.caseVersion.section,
      expected: it.cycleCase.caseVersion.expectedResult,
      plan: it.plan,
      status: it.status,
      statusNote: it.statusNote,
      currentStep: it.currentStep,
      takeover: it.takeover,
      pause: it.pause,
      lastShotId: it.lastShotId,
      result,
      proposed: a?.proposedOutcome ?? null,
      verifiedBy,
      summary: a?.actualResult ?? null,
      evidence: a?.evidence ?? [],
      openRequests: it.requests.filter((r) => r.status === "OPEN").map((r) => ({ id: r.id, kind: r.kind, question: r.question, detail: r.detail })),
    };
  });
  const count = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).length;
  // The case shown in the step log: the one running now, else the one that ran last.
  const focusRow =
    (focusItemId ? run.items.find((i) => i.id === focusItemId) : undefined) ??
    run.items.find((i) => i.status === "RUNNING") ??
    [...run.items].filter((i) => i.startedAt).sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))[0] ??
    null;
  const focus = focusRow
    ? {
        itemId: focusRow.id,
        steps: (await db.agentStep.findMany({ where: { runItemId: focusRow.id }, orderBy: { createdAt: "asc" }, take: 200 })).map((st) => ({
          id: st.id,
          kind: st.kind,
          label: st.label,
          thought: st.thought,
          result: st.result,
          ok: st.ok,
          at: st.createdAt.toISOString(),
        })),
      }
    : null;
  return {
    id: run.id,
    status: run.status,
    model: run.model,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    cycle: { id: run.cycle.id, name: run.cycle.name, buildLabel: run.cycle.buildLabel },
    environment: { name: run.environment.name, targetUrl: run.environment.targetUrl },
    runnerOnline,
    totals: {
      total: items.length,
      passed: count((i) => i.result === "PASS"),
      failed: count((i) => i.result === "FAIL"),
      blocked: count((i) => i.result === "BLOCKED"),
      needsYou: count((i) => i.openRequests.length > 0),
      running: count((i) => i.status === "RUNNING"),
      queued: count((i) => i.status === "QUEUED"),
      skipped: count((i) => i.status === "SKIPPED" && !i.result),
      done: count((i) => i.result !== null || (i.status === "SKIPPED" && i.openRequests.length === 0)),
    },
    items,
    focus,
    events: run.events.map((e) => ({ at: e.createdAt.toISOString(), message: e.message })),
  };
}

export async function listRuns(db: Db, applicationId: string) {
  return db.testRun.findMany({
    where: { cycle: { applicationId } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { environment: true, cycle: true, items: { select: { status: true } } },
  });
}

export async function cancelRun(db: Db, applicationId: string, runId: string, user: string) {
  const run = await db.testRun.findFirst({ where: { id: runId, cycle: { applicationId } } });
  if (!run) throw notFound("Run not found.");
  const items = await db.runItem.findMany({ where: { runId, attemptId: { not: null } }, select: { attemptId: true } });
  for (const it of items) await discardUndecidedAgentAttempt(db, it.attemptId!);
  await db.$transaction([
    db.runItem.updateMany({ where: { runId, status: { in: ["QUEUED", "WAITING", "NEEDS_HUMAN"] } }, data: { status: "SKIPPED", statusNote: `Run cancelled by ${user}.` } }),
    db.humanRequest.updateMany({ where: { runItem: { runId }, status: "OPEN" }, data: { status: "SKIPPED", answer: "run cancelled", answeredBy: user, answeredAt: new Date() } }),
    db.testRun.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: new Date() } }),
    db.runEvent.create({ data: { runId, message: `Run cancelled by ${user}.` } }),
  ]);
}

/**
 * Remove an AI attempt that no person has decided on (e.g. when retrying or
 * cancelling). It never reached a result, so it should not linger in history.
 */
export async function discardUndecidedAgentAttempt(db: Db, attemptId: string) {
  const a = await db.executionAttempt.findUnique({ where: { id: attemptId }, include: { evidence: true } });
  if (!a || a.source !== "AI_AGENT") return;
  const decidedByPerson = a.status === "COMPLETED" && (a.humanCheckpointBy !== null || a.outcome === "PASS");
  if (decidedByPerson) return;
  const storage = getEvidenceStorage();
  await db.$transaction([
    db.runItem.updateMany({ where: { attemptId }, data: { attemptId: null, lastShotId: null } }),
    db.evidence.deleteMany({ where: { attemptId } }),
    db.executionAttempt.delete({ where: { id: attemptId } }),
  ]);
  for (const e of a.evidence) await storage.remove(e.storageKey).catch(() => {});
}

// ------------------------------------------------------------------ people answering

export const answerSchema = z.object({
  action: z.enum(["answer", "skip", "confirm", "override_pass", "override_fail", "override_blocked", "retry", "recheck"]),
  text: z.string().trim().max(5000).nullish(),
});

export async function answerRequest(db: Db, applicationId: string, requestId: string, input: z.infer<typeof answerSchema>, user: string) {
  const req = await db.humanRequest.findUnique({
    where: { id: requestId },
    include: { runItem: { include: { run: { include: { cycle: true } }, attempt: true } } },
  });
  if (!req || req.runItem.run.cycle.applicationId !== applicationId) throw notFound("Request not found.");
  if (req.status !== "OPEN") throw conflict("This was already answered.");
  const item = req.runItem;
  const close = (status: "ANSWERED" | "SKIPPED", answer: string | null) =>
    db.humanRequest.update({ where: { id: req.id }, data: { status, answer, answeredBy: user, answeredAt: new Date() } });
  const event = (message: string) => db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message } });

  if (input.action === "skip") {
    await close("SKIPPED", input.text ?? null);
    if (req.kind !== "INPUT" || item.status === "NEEDS_HUMAN") {
      await db.runItem.update({ where: { id: item.id }, data: { status: "SKIPPED", statusNote: input.text || `Skipped by ${user}.` } });
    }
    await event(`${user} skipped: ${req.question}`);
    await maybeFinishRun(db, item.runId);
    return { ok: true };
  }
  if (req.kind === "INPUT") {
    if (input.action !== "answer" || !input.text) throw badRequest("Type an answer, or skip.");
    await close("ANSWERED", input.text);
    if (item.status === "NEEDS_HUMAN") {
      // The case was parked while waiting: run it again with this answer.
      if (item.attempt && item.attempt.status !== "COMPLETED") await discardUndecidedAgentAttempt(db, item.attempt.id);
      await db.runItem.update({ where: { id: item.id }, data: { status: "QUEUED", attemptId: null, statusNote: "Answer received; the AI will run this case again." } });
      await db.testRun.update({ where: { id: item.runId }, data: { status: "RUNNING", finishedAt: null } });
    }
    await event(`${user} answered the AI's question.`);
    return { ok: true };
  }
  if (input.action === "retry" || input.action === "recheck") {
    // "Done, check it again": the person fixed something, did the manual part, or wants
    // the case run despite a prerequisite. The AI revisits it next and confirms the result.
    // Back in the queue first, so cases waiting on this one keep waiting instead of
    // being told it failed.
    await close("ANSWERED", `${RECHECK_PREFIX}${input.text ? `: ${input.text}` : ""}`);
    await db.runItem.update({
      where: { id: item.id },
      data: { status: "QUEUED", statusNote: `${user} asked the AI to check this again.`, attemptId: null, finishedAt: null },
    });
    await db.testRun.update({ where: { id: item.runId }, data: { status: "RUNNING", finishedAt: null } });
    const a = item.attempt;
    if (a && a.status !== "COMPLETED") {
      if (a.proposedOutcome === "FAIL" && req.kind === "CONFIRM_RESULT") {
        // Keep the failure in the history; the re-check becomes the next attempt (a retest).
        await completeAttempt(db, a.id, { outcome: "FAIL", outcomeReason: a.outcomeReason || "Failed; re-check requested after a fix", humanCheckpointConfirmed: true }, user);
      } else {
        await discardUndecidedAgentAttempt(db, a.id);
      }
    }
    await event(`${user} asked the AI to check ${req.question.split(/[: ]/)[0]} again.`);
    return { ok: true };
  }
  // CONFIRM_RESULT / RUN_ERROR decisions on the AI's attempt
  const a = item.attempt;
  if (!a || a.status === "COMPLETED") throw conflict("There is no open AI attempt to decide on.");
  const outcome =
    input.action === "confirm" ? (a.proposedOutcome ?? null) : input.action === "override_pass" ? "PASS" : input.action === "override_fail" ? "FAIL" : input.action === "override_blocked" ? "BLOCKED" : null;
  if (!outcome || outcome === "NOT_RUN") throw badRequest("Choose a result.");
  if (outcome === "PASS") {
    // The reviewer vouches for the checks the AI could not confirm.
    await db.stepOutcome.updateMany({ where: { attemptId: a.id, result: { not: "PASS" } }, data: { result: "PASS", note: `Confirmed by ${user}` } });
  }
  await completeAttempt(
    db,
    a.id,
    { outcome, outcomeReason: outcome === "PASS" ? null : input.text || a.outcomeReason || `Confirmed by ${user}`, humanCheckpointConfirmed: true },
    user,
  );
  await close("ANSWERED", `${input.action}${input.text ? `: ${input.text}` : ""}`);
  await db.runItem.update({ where: { id: item.id }, data: { status: "DONE", statusNote: `Decided by ${user}.` } });
  await event(`${user} recorded ${outcome} for ${req.question.split(":")[0]}.`);
  await maybeFinishRun(db, item.runId);
  return { ok: true };
}

export async function maybeFinishRun(db: Db, runId: string) {
  await releaseWaiting(db, runId);
  const open = await db.runItem.count({ where: { runId, status: { in: ["QUEUED", "RUNNING"] } } });
  const run = await db.testRun.findUniqueOrThrow({ where: { id: runId } });
  if (open === 0 && run.status === "RUNNING") {
    await db.testRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date() } });
    await db.runEvent.create({ data: { runId, message: "The AI has finished every case it could run." } });
  }
}

// ------------------------------------------------------------------ runner side

/** Live view: the latest frame of the runner's browser, shown beside the run page. */
export async function publishFrame(db: Db, runItemId: string, jpeg: Uint8Array) {
  const frame = new Uint8Array(jpeg);
  const now = new Date();
  await db.runnerStatus.upsert({
    where: { id: "local" },
    create: { id: "local", lastSeenAt: now, info: "running", frame, frameAt: now, frameItemId: runItemId },
    update: { frame, frameAt: now, frameItemId: runItemId },
  });
}

/** Frames older than this are not live any more (the case ended or the runner stopped). */
const FRAME_STALE_MS = 15_000;

export async function liveFrame(db: Db, applicationId: string, runId: string) {
  const r = await db.runnerStatus.findUnique({ where: { id: "local" }, select: { frame: true, frameAt: true, frameItemId: true } });
  if (!r?.frame || !r.frameAt || !r.frameItemId || Date.now() - r.frameAt.getTime() > FRAME_STALE_MS) return null;
  const item = await db.runItem.findFirst({ where: { id: r.frameItemId, runId, run: { cycle: { applicationId } } }, select: { id: true } });
  return item ? { jpeg: r.frame, at: r.frameAt, runItemId: item.id } : null;
}

export async function heartbeat(db: Db, info: string) {
  await db.runnerStatus.upsert({ where: { id: "local" }, create: { id: "local", lastSeenAt: new Date(), info }, update: { lastSeenAt: new Date(), info } });
}

/** Claim the next queued item (single local runner; guarded update avoids double claims). */
export async function claimNext(db: Db) {
  const next = await db.runItem.findFirst({
    where: { status: "QUEUED", run: { status: "RUNNING" } },
    orderBy: [{ run: { createdAt: "asc" } }, { sortOrder: "asc" }],
  });
  if (!next) return null;
  const { count } = await db.runItem.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), currentStep: "Starting" } });
  if (!count) return null;
  return db.runItem.findUniqueOrThrow({
    where: { id: next.id },
    include: {
      run: { include: { environment: true, cycle: { include: { application: true } } } },
      cycleCase: { include: { testCase: true, caseVersion: true } },
    },
  });
}
export type ClaimedItem = NonNullable<Awaited<ReturnType<typeof claimNext>>>;

/**
 * If a case this one depends on hasn't passed yet in this run, park this one as WAITING
 * (not skipped): it starts by itself when the prerequisite passes. Returns the reason, or
 * null when the case can run now.
 */
export async function waitForPrerequisites(db: Db, item: ClaimedItem): Promise<string | null> {
  if (await personAskedToRecheck(db, item.id)) return null;
  const st = await dependencyState(db, item.runId, item.cycleCase.caseVersion.preconditions, item.cycleCase.testCase.externalId);
  const blocking = [...st.pending, ...st.notPassed];
  if (!blocking.length) return null;
  const why = `Waits for ${blocking.join(", ")} to pass. It starts by itself when ${blocking.length === 1 ? "it does" : "they do"}.`;
  await db.runItem.update({ where: { id: item.id }, data: { status: "WAITING", statusNote: why, currentStep: null, startedAt: null } });
  await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${item.cycleCase.testCase.externalId}: waiting for ${blocking.join(", ")}.` } });
  await maybeFinishRun(db, item.runId);
  return why;
}

export async function progress(db: Db, itemId: string, step: string, runId: string, logIt = false) {
  await db.runItem.update({ where: { id: itemId }, data: { currentStep: step.slice(0, 300) } });
  if (logIt) await db.runEvent.create({ data: { runId, runItemId: itemId, message: step.slice(0, 500) } });
}

/** Open (or reuse) the AI's attempt for this item. */
export async function openAgentAttempt(db: Db, item: ClaimedItem, agentLabel: string) {
  const last = await db.executionAttempt.findFirst({ where: { cycleCaseId: item.cycleCaseId }, orderBy: { attemptNumber: "desc" } });
  const steps = (item.cycleCase.caseVersion.steps as { text: string; required: boolean }[] | null) ?? [];
  const attempt = await db.executionAttempt.create({
    data: {
      cycleCaseId: item.cycleCaseId,
      caseVersionId: item.cycleCase.caseVersionId,
      attemptNumber: (last?.attemptNumber ?? 0) + 1,
      status: "RUNNING",
      tester: agentLabel,
      agentLabel,
      executionMethod: "AI_DRIVEN",
      source: "AI_AGENT",
      buildLabel: item.run.cycle.buildLabel,
      startedAt: new Date(),
      stepOutcomes: { create: steps.map((s, i) => ({ stepIndex: i, stepText: s.text, required: s.required !== false })) },
    },
  });
  await db.runItem.update({ where: { id: item.id }, data: { attemptId: attempt.id } });
  return attempt;
}

export interface AgentFinish {
  verdict: "PASS" | "FAIL" | "BLOCKED";
  summary: string;
  confidence: number;
  checks: CheckRecord[];
  steps: StepRecord[];
  screenshots: number;
  partialNote?: string | null;
  /** A person used the browser during this case: never record the result without them. */
  humanTouched?: boolean;
  /** Why a person must confirm, shown in Needs you (defaults to "a person used the browser"). */
  why?: string;
}

export async function finishAgentAttempt(db: Db, item: ClaimedItem, attemptId: string, f: AgentFinish) {
  const versionSteps = (item.cycleCase.caseVersion.steps as { text: string; required: boolean }[] | null) ?? [];
  for (const s of f.steps) {
    await db.stepOutcome.updateMany({ where: { attemptId, stepIndex: s.stepIndex }, data: { result: s.result, note: s.note || null } });
  }
  const checksText = f.checks.map((c) => `${c.passed ? "✓" : "✕"} ${c.description} (${c.detail})`).join("\n");
  const setupDone = item.purpose === "SETUP" && f.verdict === "PASS" && f.checks.length > 0 && f.checks.every((c) => c.passed);
  const decision = f.humanTouched && !setupDone ? ({ kind: "CONFIRM", proposed: f.verdict, why: f.why ?? "A person used the browser during this run, so please confirm the result." } as const) : setupDone ? ({ kind: "AUTO_PASS" } as const) : decide({
    verdict: f.verdict,
    confidence: f.confidence,
    checks: f.checks,
    steps: f.steps,
    requiredSteps: versionSteps.map((s, i) => (s.required !== false ? i : -1)).filter((i) => i >= 0),
    screenshots: f.screenshots,
  });
  const common = {
    actualResult: f.summary,
    remarks: checksText ? `Checks run in the browser:\n${checksText}` : "No explicit checks were run.",
    aiConfidence: f.confidence,
    partialCoverage: Boolean(f.partialNote),
    partialCoverageNote: f.partialNote ?? null,
  };
  if (decision.kind === "AUTO_PASS") {
    await db.executionAttempt.update({
      where: { id: attemptId },
      data: { ...common, status: "COMPLETED", outcome: "PASS", proposedOutcome: "PASS", completedAt: new Date(), executedOn: isoDateToDbDate(todayIso()) },
    });
    await db.runItem.update({ where: { id: item.id }, data: { status: "DONE", statusNote: "Passed: verified by AI.", finishedAt: new Date(), currentStep: null } });
    await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${item.cycleCase.testCase.externalId} passed (verified by AI).` } });
  } else if (item.purpose === "SETUP") {
    // Setup is plumbing, not a result you asked for: note it, don't interrupt anyone.
    await db.executionAttempt.update({
      where: { id: attemptId },
      data: { ...common, status: "AWAITING_REVIEW", proposedOutcome: decision.proposed, outcomeReason: decision.proposed === "PASS" ? null : f.summary },
    });
    await db.runItem.update({ where: { id: item.id }, data: { status: "SKIPPED", statusNote: `Setup did not complete cleanly (${decision.why}) Cases that depend on it may be skipped.`, finishedAt: new Date(), currentStep: null } });
    await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `Setup ${item.cycleCase.testCase.externalId}: did not complete cleanly (${decision.why})` } });
  } else {
    await db.executionAttempt.update({
      where: { id: attemptId },
      data: { ...common, status: "AWAITING_REVIEW", proposedOutcome: decision.proposed, outcomeReason: decision.proposed === "PASS" ? null : f.summary },
    });
    await db.runItem.update({ where: { id: item.id }, data: { status: "NEEDS_HUMAN", statusNote: decision.why, finishedAt: new Date(), currentStep: null } });
    await db.humanRequest.create({
      data: {
        runItemId: item.id,
        kind: "CONFIRM_RESULT",
        question: `${item.cycleCase.testCase.externalId}: AI suggests ${decision.proposed}. ${decision.why}`,
        detail: f.summary,
      },
    });
    await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${item.cycleCase.testCase.externalId}: needs you (${decision.why})` } });
  }
  await maybeFinishRun(db, item.runId);
  return decision;
}

export async function failItem(db: Db, item: ClaimedItem, attemptId: string | null, why: string) {
  if (item.purpose === "SETUP") {
    if (attemptId) await discardUndecidedAgentAttempt(db, attemptId);
    return skipItem(db, item, `Setup could not finish: ${why}`);
  }
  if (attemptId) {
    await db.executionAttempt.update({ where: { id: attemptId }, data: { status: "AWAITING_REVIEW", proposedOutcome: "BLOCKED", outcomeReason: why, actualResult: `The AI could not complete this case: ${why}` } });
  }
  await db.runItem.update({ where: { id: item.id }, data: { status: "NEEDS_HUMAN", statusNote: why, finishedAt: new Date(), currentStep: null } });
  await db.humanRequest.create({ data: { runItemId: item.id, kind: "RUN_ERROR", question: `${item.cycleCase.testCase.externalId}: the AI could not finish. ${why}`, detail: null } });
  await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${item.cycleCase.testCase.externalId}: could not finish (${why})` } });
  await maybeFinishRun(db, item.runId);
}

export async function skipItem(db: Db, item: ClaimedItem, why: string) {
  await db.runItem.update({ where: { id: item.id }, data: { status: "SKIPPED", statusNote: why, finishedAt: new Date(), currentStep: null } });
  await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${item.cycleCase.testCase.externalId}: skipped (${why})` } });
  await maybeFinishRun(db, item.runId);
}

/**
 * Ask a person mid-run and wait briefly. If nobody answers in time the case is
 * parked (see parkItem) so the rest of the run continues; answering re-queues it.
 */
export async function askAndWait(
  db: Db,
  item: ClaimedItem,
  question: string,
  timeoutMs = Number(process.env.RUNNER_ASK_WAIT_MS || 15_000),
): Promise<{ status: "answered"; answer: string } | { status: "skipped" } | { status: "timeout" }> {
  const req = await db.humanRequest.create({ data: { runItemId: item.id, kind: "INPUT", question: `${item.cycleCase.testCase.externalId}: ${question}` } });
  await db.runItem.update({ where: { id: item.id }, data: { currentStep: "Waiting for your answer" } });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await db.humanRequest.findUniqueOrThrow({ where: { id: req.id } });
    if (r.status === "ANSWERED") return { status: "answered", answer: r.answer ?? "" };
    if (r.status === "SKIPPED") return { status: "skipped" };
    await heartbeat(db, "waiting for a person");
    await new Promise((res) => setTimeout(res, 2000));
  }
  return { status: "timeout" };
}

/**
 * Park a case that is waiting for a person; the run carries on with other cases. No result
 * is recorded: the case shows as waiting for you, and answering puts it back in the queue.
 */
export async function parkItem(db: Db, item: ClaimedItem, attemptId: string, question: string) {
  await db.executionAttempt.update({ where: { id: attemptId }, data: { remarks: `Paused: waiting for an answer from a person (${question})` } });
  await db.runItem.update({
    where: { id: item.id },
    data: { status: "NEEDS_HUMAN", statusNote: "Waiting for your answer. Answer it and the AI will pick this case up again.", currentStep: null, finishedAt: new Date() },
  });
  await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${item.cycleCase.testCase.externalId}: paused until you answer; moving on to the next case.` } });
  await maybeFinishRun(db, item.runId);
}

/** What people said about this case in earlier tries (fed back to the AI when it revisits). */
export async function previousAnswers(db: Db, itemId: string) {
  const rows = await db.humanRequest.findMany({
    where: { runItemId: itemId, status: "ANSWERED", OR: [{ kind: "INPUT" }, { answer: { startsWith: RECHECK_PREFIX } }] },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) =>
    r.kind === "INPUT"
      ? r
      : { ...r, answer: `A person dealt with this and asked you to check the case again${r.answer && r.answer.length > RECHECK_PREFIX.length ? ` (their note: ${r.answer.slice(RECHECK_PREFIX.length + 2)})` : ""}.` },
  );
}

export type { Prisma };
