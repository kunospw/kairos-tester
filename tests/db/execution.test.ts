import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, importRows, sampleRows } from "./helpers";
import { createCycle } from "@/server/services/cycle-service";
import { startOrResumeAttempt, saveAttemptDraft, completeAttempt } from "@/server/services/execution-service";
import { editCase } from "@/server/services/case-service";
import { loadCycleResults } from "@/server/services/results";
import { HttpError } from "@/server/http";

const db = testDb();
afterAll(() => db.$disconnect());

let appId: string;
let cycleId: string;
beforeEach(async () => {
  await resetDb(db);
  appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
  cycleId = (await createCycle(db, appId, { name: "Build 2", kind: "STANDARD", buildLabel: "2.0", include: { mode: "all" } }, "tester")).id;
});

async function ccFor(externalId: string) {
  return db.cycleCase.findFirstOrThrow({ where: { cycleId, testCase: { externalId } }, include: { caseVersion: true } });
}

describe("new cycles", () => {
  it("start every case as Not run, without carrying historical passes", async () => {
    const res = await loadCycleResults(db, cycleId);
    expect(res.metrics).toMatchObject({ total: 5, NOT_RUN: 5, PASS: 0 });
    expect(res.metrics.passRate).toBeNull();
    expect(await db.executionAttempt.count({ where: { cycleCase: { cycleId } } })).toBe(0);
  });
});

describe("manual execution and retest", () => {
  it("saves drafts, resumes them, and blocks Pass while required checks are unfinished", async () => {
    const cc = await ccFor("SI-01");
    const { attempt } = await startOrResumeAttempt(db, cc.id, "tester");
    expect(attempt.status).toBe("DRAFT");
    expect(attempt.buildLabel).toBe("2.0");
    await saveAttemptDraft(db, attempt.id, { actualResult: "halfway", steps: [{ stepIndex: 0, result: "PASS" }] });
    const resumed = await startOrResumeAttempt(db, cc.id, "tester");
    expect(resumed.resumed).toBe(true);
    expect(resumed.attempt.id).toBe(attempt.id);
    expect(resumed.attempt.actualResult).toBe("halfway");

    const err = await completeAttempt(db, attempt.id, { outcome: "PASS", tester: "tester" }, "tester").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).details).toEqual(expect.arrayContaining([expect.stringMatching(/required check/)]));
    // Entered data is preserved after a failed completion.
    expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("DRAFT");
  });

  it("requires a reason for Fail, and a retest creates a new attempt preserving the earlier one", async () => {
    const cc = await ccFor("SI-01");
    const { attempt: a1 } = await startOrResumeAttempt(db, cc.id, "tester");
    await expect(completeAttempt(db, a1.id, { outcome: "FAIL", tester: "tester" }, "tester")).rejects.toThrow(/Cannot complete/);
    await completeAttempt(db, a1.id, { outcome: "FAIL", outcomeReason: "Error 500 on Sign in", tester: "tester" }, "tester");

    const { attempt: a2, resumed } = await startOrResumeAttempt(db, cc.id, "tester");
    expect(resumed).toBe(false);
    expect(a2.attemptNumber).toBe(2);
    await completeAttempt(
      db,
      a2.id,
      { outcome: "PASS", tester: "tester", steps: [0, 1, 2].map((i) => ({ stepIndex: i, result: "PASS" as const })) },
      "tester",
    );

    const attempts = await db.executionAttempt.findMany({ where: { cycleCaseId: cc.id }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((a) => [a.attemptNumber, a.outcome, a.outcomeReason])).toEqual([
      [1, "FAIL", "Error 500 on Sign in"],
      [2, "PASS", null],
    ]);
    // Completed attempts are immutable.
    await expect(saveAttemptDraft(db, a1.id, { remarks: "edit" })).rejects.toThrow(/completed/);
    const res = await loadCycleResults(db, cycleId);
    expect(res.rows.find((r) => r.externalId === "SI-01")!.outcome).toBe("PASS");
  });

  it("editing a case creates a new version while history keeps the instructions it used", async () => {
    const cc = await ccFor("SI-01");
    const { attempt } = await startOrResumeAttempt(db, cc.id, "tester");
    await completeAttempt(db, attempt.id, { outcome: "BLOCKED", outcomeReason: "No inbox", tester: "tester" }, "tester");
    const v1 = cc.caseVersion;
    const { version: v2 } = await editCase(
      db,
      cc.testCaseId,
      {
        title: "Sign in with a one-time code (clarified)",
        section: v1.section,
        role: v1.role,
        environment: v1.environment,
        preconditions: v1.preconditions,
        stepsText: v1.stepsText,
        expectedResult: v1.expectedResult,
        testData: null,
        priority: "HIGH",
        executionMode: "MANUAL",
        categories: ["regression"],
        dependsOn: null,
        basedOnVersion: 1,
      },
      "tester",
    );
    expect(v2.versionNumber).toBe(2);
    const stored = await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id }, include: { caseVersion: true } });
    expect(stored.caseVersion.title).toBe("Sign in with a one-time code");
    expect((await db.testCaseVersion.findUniqueOrThrow({ where: { id: v1.id } })).title).toBe("Sign in with a one-time code");
    // Stale edit is rejected.
    await expect(
      editCase(db, cc.testCaseId, { ...v2, testData: "x", categories: [], basedOnVersion: 1 } as never, "tester"),
    ).rejects.toThrow(/changed since you opened it/);
  });

  it("hybrid cases need a human checkpoint to complete", async () => {
    const cc = await ccFor("SI-03");
    const v = cc.caseVersion;
    await editCase(
      db,
      cc.testCaseId,
      { ...v, testData: null, categories: [], executionMode: "HYBRID", steps: undefined, basedOnVersion: v.versionNumber } as never,
      "tester",
    );
    const { adoptLatestVersion } = await import("@/server/services/cycle-service");
    await adoptLatestVersion(db, cc.id);
    const { attempt } = await startOrResumeAttempt(db, cc.id, "tester");
    expect(attempt.executionMethod).toBe("HYBRID");
    const steps = [{ stepIndex: 0, result: "PASS" as const }];
    await expect(completeAttempt(db, attempt.id, { outcome: "PASS", tester: "tester", steps }, "tester")).rejects.toThrow(/Cannot complete/);
    const done = await completeAttempt(db, attempt.id, { outcome: "PASS", tester: "tester", steps, humanCheckpointConfirmed: true }, "tester");
    expect(done.status).toBe("COMPLETED");
    expect(done.humanCheckpointBy).toBe("tester");
  });
});
