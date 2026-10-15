import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, importRows, sampleRows, tempStorage, PNG_BYTES } from "./helpers";
import {
  startRun,
  claimNext,
  openAgentAttempt,
  finishAgentAttempt,
  answerRequest,
  runView,
  unmetDependency,
  failItem,
} from "@/server/services/run-service";
import { addEvidence } from "@/server/services/evidence-service";
import { completeAttempt, startOrResumeAttempt } from "@/server/services/execution-service";
import { loadCycleResults } from "@/server/services/results";
import { attentionCounts, inbox } from "@/server/services/attention-service";

const db = testDb();
afterAll(() => db.$disconnect());
const { storage } = tempStorage();

let appId: string;
let envId: string;
const profile = {
  baseUrl: "http://localhost:3000",
  signIn: { method: "none" },
  roleSwitch: { method: "none" },
  caseEnvironments: ["Demo"],
  roleAccounts: { "K admin": null },
};

beforeEach(async () => {
  await resetDb(db);
  appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  envId = (await db.environment.create({ data: { applicationId: appId, name: "Demo (local)", type: "DEMO", agentProfile: profile } })).id;
  await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
});

const pass = { verdict: "PASS" as const, summary: "All good.", confidence: 0.9, checks: [{ description: "shown", kind: "text_visible", passed: true, detail: "found" }], screenshots: 1 };

async function claimAndFinish(f: Parameters<typeof finishAgentAttempt>[3]) {
  const item = (await claimNext(db))!;
  const attempt = await openAgentAttempt(db, item, "Kairos AI (test)");
  await addEvidence(db, attempt.id, { name: "s.png", bytes: PNG_BYTES }, "shot", "ai", storage);
  const steps = ((item.cycleCase.caseVersion.steps as unknown[]) ?? []).map((_, i) => ({ stepIndex: i, result: "PASS" as const, note: "" }));
  return { item, attempt, decision: await finishAgentAttempt(db, item, attempt.id, { ...f, steps: f.steps ?? steps }) };
}

describe("AI runs", () => {
  it("plans each case and only queues what the AI can do; a run gets its own Not-run cycle", async () => {
    const run = await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    const items = await db.runItem.findMany({ where: { runId: run.id }, include: { cycleCase: { include: { testCase: true } } }, orderBy: { sortOrder: "asc" } });
    const by = Object.fromEntries(items.map((i) => [i.cycleCase.testCase.externalId, i]));
    expect(by["AD-01"].plan).toBe("NEEDS_HUMAN"); // Cloud2
    expect(by["SI-02"].plan).toBe("NEEDS_HUMAN"); // real inbox / wait minutes
    expect(by["SI-01"].status).toBe("QUEUED");
    expect(await db.humanRequest.count({ where: { kind: "MANUAL_CASE" } })).toBe(2);
    const res = await loadCycleResults(db, run.cycleId);
    expect(res.metrics.NOT_RUN).toBe(5);
  });

  it("records a fully-backed pass automatically as verified by AI", async () => {
    const run = await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    const { attempt, decision } = await claimAndFinish({ ...pass, steps: undefined as never });
    expect(decision.kind).toBe("AUTO_PASS");
    const a = await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(a).toMatchObject({ status: "COMPLETED", outcome: "PASS", executionMethod: "AI_DRIVEN", humanCheckpointBy: null });
    const view = await runView(db, appId, run.id);
    expect(view.items.find((i) => i.result === "PASS")!.verifiedBy).toBe("AI");
  });

  it("asks a person to confirm a failure, and the person's decision is recorded", async () => {
    await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    const { attempt, decision } = await claimAndFinish({ ...pass, verdict: "FAIL", summary: "Error 500.", checks: [{ ...pass.checks[0], passed: false, detail: "not found" }], steps: undefined as never });
    expect(decision).toMatchObject({ kind: "CONFIRM", proposed: "FAIL" });
    expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("AWAITING_REVIEW");
    const req = await db.humanRequest.findFirstOrThrow({ where: { kind: "CONFIRM_RESULT" } });
    await answerRequest(db, appId, req.id, { action: "confirm", text: "Reproduced" }, "dyah");
    const a = await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(a).toMatchObject({ status: "COMPLETED", outcome: "FAIL", humanCheckpointBy: "dyah" });
  });

  it("lets a person override an uncertain AI pass, and retry a stuck case", async () => {
    await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    const { item } = await claimAndFinish({ ...pass, checks: [], steps: undefined as never });
    const req = await db.humanRequest.findFirstOrThrow({ where: { kind: "CONFIRM_RESULT" } });
    await answerRequest(db, appId, req.id, { action: "override_pass" }, "dyah");
    expect((await db.runItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("DONE");

    const next = (await claimNext(db))!;
    const att = await openAgentAttempt(db, next, "Kairos AI (test)");
    await failItem(db, next, att.id, "Did not finish within 40 actions.");
    const err = await db.humanRequest.findFirstOrThrow({ where: { kind: "RUN_ERROR" } });
    await answerRequest(db, appId, err.id, { action: "retry" }, "dyah");
    const again = await db.runItem.findUniqueOrThrow({ where: { id: next.id } });
    expect(again.status).toBe("QUEUED");
    // The undecided AI attempt is discarded rather than recorded as a fake result.
    expect(await db.executionAttempt.findUnique({ where: { id: att.id } })).toBeNull();
  });

  it("closes a 'needs you' case when the person records it manually", async () => {
    const run = await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    const item = await db.runItem.findFirstOrThrow({ where: { runId: run.id, plan: "NEEDS_HUMAN" } });
    const { attempt } = await startOrResumeAttempt(db, item.cycleCaseId, "dyah");
    await completeAttempt(db, attempt.id, { outcome: "BLOCKED", outcomeReason: "Cloud2 unavailable", tester: "dyah" }, "dyah");
    const after = await db.runItem.findUniqueOrThrow({ where: { id: item.id }, include: { requests: true } });
    expect(after.status).toBe("DONE");
    expect(after.requests.every((r) => r.status === "ANSWERED")).toBe(true);
  });

  it("closes the run's confirm request when the result is decided in the Needs-you inbox", async () => {
    await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    const { item, attempt } = await claimAndFinish({ ...pass, verdict: "FAIL", summary: "Error 500.", checks: [{ ...pass.checks[0], passed: false, detail: "not found" }], steps: undefined as never });
    const req = await db.humanRequest.findFirstOrThrow({ where: { kind: "CONFIRM_RESULT" } });
    // Inbox decision goes through the attempt, not the request.
    await completeAttempt(db, attempt.id, { outcome: "FAIL", outcomeReason: "Reproduced", humanCheckpointConfirmed: true }, "dyah");
    expect((await db.humanRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("ANSWERED");
    expect((await db.runItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("DONE");
    // The run page card is gone, and answering it from a stale page is refused cleanly.
    await expect(answerRequest(db, appId, req.id, { action: "confirm" }, "dyah")).rejects.toThrow(/already answered/);
  });

  it("counts each thing that needs a person once, and forgets it once decided", async () => {
    await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    // Two cases need a person from the start (Cloud2, real inbox).
    expect(await attentionCounts(db, appId)).toMatchObject({ needsYou: 2, questions: 2, reviews: 0 });

    // An AI result to confirm shows once (as a review), not also as its CONFIRM_RESULT request.
    const { attempt } = await claimAndFinish({ ...pass, checks: [], steps: undefined as never });
    expect(await attentionCounts(db, appId)).toMatchObject({ needsYou: 3, questions: 2, reviews: 1 });

    // A case the AI could not finish shows once, as its request.
    const next = (await claimNext(db))!;
    const stuck = await openAgentAttempt(db, next, "Kairos AI (test)");
    await failItem(db, next, stuck.id, "stuck");
    const box = await inbox(db, appId);
    expect(box.requests.map((r) => r.kind).sort()).toEqual(["MANUAL_CASE", "MANUAL_CASE", "RUN_ERROR"]);
    expect(box.reviews.map((a) => a.id)).toEqual([attempt.id]);

    await completeAttempt(db, attempt.id, { outcome: "PASS", humanCheckpointConfirmed: true }, "dyah");
    expect(await attentionCounts(db, appId)).toMatchObject({ needsYou: 3, questions: 3, reviews: 0 });
  });

  it("does not ask anyone about setup re-runs", async () => {
    const hist = await db.testCycle.findFirstOrThrow({ where: { applicationId: appId, kind: "HISTORICAL_IMPORT" } });
    await startRun(db, appId, { environmentId: envId, scope: { mode: "continue_cycle", cycleId: hist.id, includeBlocked: false, includeFailed: false, withSetup: true } }, "dyah");
    const { item } = await claimAndFinish({ ...pass, checks: [], steps: undefined as never });
    expect(item.purpose).toBe("SETUP");
    expect((await db.executionAttempt.findFirstOrThrow({ where: { runItems: { some: { id: item.id } } } })).status).toBe("AWAITING_REVIEW");
    expect((await attentionCounts(db, appId)).reviews).toBe(0);
  });

  it("skips a case whose dependency did not pass in this run", async () => {
    await db.testCaseVersion.updateMany({ where: { testCase: { externalId: "SI-03" } }, data: { preconditions: "SI-01 done." } });
    await startRun(db, appId, { environmentId: envId, scope: { mode: "all" } }, "dyah");
    const si01 = (await claimNext(db))!;
    expect(si01.cycleCase.testCase.externalId).toBe("SI-01");
    const att = await openAgentAttempt(db, si01, "ai");
    await failItem(db, si01, att.id, "stuck");
    const si03 = (await claimNext(db))!;
    expect(si03.cycleCase.testCase.externalId).toBe("SI-03");
    expect(await unmetDependency(db, si03)).toMatch(/Depends on SI-01/);
  });

  it("continues an imported round: only unfinished cases, results added to the same cycle", async () => {
    const hist = await db.testCycle.findFirstOrThrow({ where: { applicationId: appId, kind: "HISTORICAL_IMPORT" } });
    const cyclesBefore = await db.testCycle.count();
    const attemptsBefore = await db.executionAttempt.count();
    const run = await startRun(db, appId, { environmentId: envId, scope: { mode: "continue_cycle", cycleId: hist.id, includeBlocked: false, includeFailed: false, withSetup: false } }, "dyah");
    expect(run.cycleId).toBe(hist.id);
    expect(await db.testCycle.count()).toBe(cyclesBefore); // no new cycle
    const items = await db.runItem.findMany({ where: { runId: run.id }, include: { cycleCase: { include: { testCase: true } } } });
    expect(items.map((i) => i.cycleCase.testCase.externalId)).toEqual(["AD-02"]); // the only Not run case
    expect(await db.executionAttempt.count()).toBe(attemptsBefore); // imported history untouched

    // Optional retries pick up Blocked and Failed cases too.
    const run2 = await startRun(db, appId, { environmentId: envId, scope: { mode: "continue_cycle", cycleId: hist.id, includeBlocked: true, includeFailed: true, withSetup: false } }, "dyah");
    const ids2 = (await db.runItem.findMany({ where: { runId: run2.id }, include: { cycleCase: { include: { testCase: true } } } })).map((i) => i.cycleCase.testCase.externalId).sort();
    expect(ids2).toEqual(["AD-01", "SI-03"]); // AD-02 is already queued in the first run, so it is not queued twice
  });

  it("re-runs earlier passed cases as setup in their own cycle, without touching the imported round", async () => {
    const hist = await db.testCycle.findFirstOrThrow({ where: { applicationId: appId, kind: "HISTORICAL_IMPORT" } });
    const before = await db.executionAttempt.count({ where: { cycleCase: { cycleId: hist.id } } });
    const run = await startRun(db, appId, { environmentId: envId, scope: { mode: "continue_cycle", cycleId: hist.id, includeBlocked: false, includeFailed: false, withSetup: true } }, "dyah");
    const items = await db.runItem.findMany({
      where: { runId: run.id },
      orderBy: { sortOrder: "asc" },
      include: { cycleCase: { include: { testCase: true, cycle: true } } },
    });
    // SI-01 passed earlier and the AI can run it -> setup; SI-02 (real inbox) and failed/blocked cases are not setup.
    expect(items.map((i) => [i.cycleCase.testCase.externalId, i.purpose])).toEqual([
      ["SI-01", "SETUP"],
      ["AD-02", "TEST"],
    ]);
    const setup = items.find((i) => i.purpose === "SETUP")!;
    expect(setup.cycleCase.cycle.name).toMatch(/^AI setup/);
    expect(setup.cycleCase.cycleId).not.toBe(hist.id);
    expect(items.find((i) => i.purpose === "TEST")!.cycleCase.cycleId).toBe(hist.id);
    expect(await db.executionAttempt.count({ where: { cycleCase: { cycleId: hist.id } } })).toBe(before);
  });
});
