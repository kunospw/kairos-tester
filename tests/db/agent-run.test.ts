import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, importRows, sampleRows } from "./helpers";
import { createCycle } from "@/server/services/cycle-service";
import { recordAgentRun, completeAttempt, saveAttemptDraft } from "@/server/services/execution-service";
import { loadCycleResults } from "@/server/services/results";

const db = testDb();
afterAll(() => db.$disconnect());

let appId: string;
let cycleId: string;
let ccId: string;
const run = {
  agentLabel: "Claude Code + Playwright",
  proposedOutcome: "PASS" as const,
  actualResult: "Signed in; landed on Projects.",
  partialCoverage: false,
  steps: [0, 1, 2].map((i) => ({ stepIndex: i, result: "PASS" as const, note: "ok" })),
};

beforeEach(async () => {
  await resetDb(db);
  appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
  cycleId = (await createCycle(db, appId, { name: "Build 3", kind: "STANDARD", include: { mode: "all" } }, "t")).id;
  ccId = (await db.cycleCase.findFirstOrThrow({ where: { cycleId, testCase: { externalId: "SI-01" } } })).id;
});

describe("AI-driven runs", () => {
  it("land in Awaiting review with only a proposed outcome, and do not count", async () => {
    const a = await recordAgentRun(db, ccId, run, "dyah");
    expect(a).toMatchObject({ status: "AWAITING_REVIEW", outcome: null, proposedOutcome: "PASS", executionMethod: "AI_DRIVEN", source: "AI_AGENT" });
    expect(a.remarks).toMatch(/requested by dyah/);
    const res = await loadCycleResults(db, cycleId);
    const row = res.rows.find((r) => r.cycleCaseId === ccId)!;
    expect(row.outcome).toBe("NOT_RUN");
    expect(row.lifecycle).toBe("AWAITING_REVIEW");
    expect(res.metrics.PASS).toBe(0);
  });

  it("need a human checkpoint to complete, which records the reviewer", async () => {
    const a = await recordAgentRun(db, ccId, run, "dyah");
    await expect(completeAttempt(db, a.id, { outcome: "PASS" }, "dyah")).rejects.toThrow(/Cannot complete/);
    const done = await completeAttempt(db, a.id, { outcome: "PASS", humanCheckpointConfirmed: true }, "dyah");
    expect(done).toMatchObject({ status: "COMPLETED", outcome: "PASS", humanCheckpointBy: "dyah", executionMethod: "AI_DRIVEN" });
  });

  it("cannot be relabelled as manual by a later save", async () => {
    const a = await recordAgentRun(db, ccId, run, "dyah");
    const saved = await saveAttemptDraft(db, a.id, { executionMethod: "MANUAL", remarks: "edited" });
    expect(saved.executionMethod).toBe("AI_DRIVEN");
  });

  it("are refused in historical cycles, with an open attempt, or for steps that do not exist", async () => {
    const hist = await db.cycleCase.findFirstOrThrow({ where: { cycle: { kind: "HISTORICAL_IMPORT" }, testCase: { externalId: "SI-01" } } });
    await expect(recordAgentRun(db, hist.id, run, "dyah")).rejects.toThrow(/historical/);
    await recordAgentRun(db, ccId, run, "dyah");
    await expect(recordAgentRun(db, ccId, run, "dyah")).rejects.toThrow(/still open/);
    const other = (await db.cycleCase.findFirstOrThrow({ where: { cycleId, testCase: { externalId: "AD-02" } } })).id;
    await expect(recordAgentRun(db, other, { ...run, steps: [{ stepIndex: 9, result: "PASS" }] }, "dyah")).rejects.toThrow(/does not exist/);
  });
});
