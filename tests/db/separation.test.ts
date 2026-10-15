import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, importRows, sampleRows, tempStorage } from "./helpers";
import { createCycle } from "@/server/services/cycle-service";
import { runSimulated } from "@/server/services/simulation-service";
import { buildReportData, createReport } from "@/server/services/report-service";
import { loadCycleResults, realCycles } from "@/server/services/results";
import { createCase, newCaseSchema } from "@/server/services/case-service";

const db = testDb();
afterAll(() => db.$disconnect());

let appA: string;
let appB: string;
beforeEach(async () => {
  await resetDb(db);
  appA = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  appB = (await db.application.create({ data: { name: "Other app" } })).id;
  await importRows(db, appA, sampleRows(), { kind: "new", name: "Historical" });
});

describe("application and cycle separation", () => {
  it("keeps the same external ID independent per application", async () => {
    await createCase(db, appB, newCaseSchema.parse({ externalId: "SI-01", title: "Different app, same ID", priority: "LOW", executionMode: "MANUAL" }), "t");
    expect(await db.testCase.count({ where: { externalId: "SI-01" } })).toBe(2);
    await expect(
      createCase(db, appA, newCaseSchema.parse({ externalId: "si-01", title: "dup", priority: "LOW", executionMode: "MANUAL" }), "t"),
    ).rejects.toThrow(/already exists/);
  });

  it("does not let a cycle include another application's cases", async () => {
    const foreign = await db.testCase.findFirstOrThrow({ where: { applicationId: appA } });
    await expect(
      createCycle(db, appB, { name: "x", kind: "STANDARD", include: { mode: "cases", testCaseIds: [foreign.id] } }, "t"),
    ).rejects.toThrow();
  });

  it("does not let a report be created from another application's cycle", async () => {
    const cycle = await db.testCycle.findFirstOrThrow({ where: { applicationId: appA } });
    await expect(createReport(db, appB, { cycleId: cycle.id, title: "x" }, "t")).rejects.toThrow(/not found/i);
  });
});

describe("simulation isolation", () => {
  it("rejects simulated runs in real cycles", async () => {
    const real = await db.testCycle.findFirstOrThrow({ where: { applicationId: appA } });
    const cc = await db.cycleCase.findFirstOrThrow({ where: { cycleId: real.id } });
    await expect(runSimulated(db, cc.id, "t", tempStorage().storage)).rejects.toThrow(/simulation demo cycle/);
  });

  it("keeps simulated results and evidence out of real summaries and reports", async () => {
    const { storage } = tempStorage();
    const sim = await createCycle(db, appA, { name: "Demo sim", kind: "SIMULATION", include: { mode: "all" } }, "t");
    const ccs = await db.cycleCase.findMany({ where: { cycleId: sim.id } });
    for (const cc of ccs) await runSimulated(db, cc.id, "t", storage);

    const simAttempts = await db.executionAttempt.findMany({ where: { cycleCase: { cycleId: sim.id } }, include: { evidence: true } });
    expect(simAttempts.length).toBe(5);
    expect(simAttempts.every((a) => a.isSimulated && a.source === "SIMULATION" && a.evidence.every((e) => e.isSimulated))).toBe(true);

    // Real cycles list and metrics are unaffected.
    expect((await realCycles(db, appA)).map((c) => c.name)).toEqual(["Historical"]);
    const real = await db.testCycle.findFirstOrThrow({ where: { applicationId: appA, kind: "HISTORICAL_IMPORT" } });
    const realRes = await loadCycleResults(db, real.id);
    expect(realRes.metrics).toMatchObject({ PASS: 2, FAIL: 1, BLOCKED: 1, NOT_RUN: 1 });

    // Reports refuse simulation cycles and real reports contain no simulated evidence.
    await expect(buildReportData(db, sim.id)).rejects.toThrow(/Simulation cycles cannot be reported/);
    const report = await buildReportData(db, real.id);
    expect(report.cases.flatMap((c) => c.evidence)).toHaveLength(0);
  });

  it("hybrid simulated runs stop at the human checkpoint instead of passing", async () => {
    const tc = await db.testCase.findFirstOrThrow({ where: { externalId: "SI-01" }, include: { versions: true } });
    const v = tc.versions[0];
    await db.testCaseVersion.create({
      data: { ...v, id: undefined, versionNumber: 2, executionMode: "HYBRID", source: "MANUAL", importRowId: null, steps: v.steps ?? [] },
    });
    const sim = await createCycle(db, appA, { name: "Sim2", kind: "SIMULATION", include: { mode: "cases", testCaseIds: [tc.id] } }, "t");
    const cc = await db.cycleCase.findFirstOrThrow({ where: { cycleId: sim.id } });
    const a = await runSimulated(db, cc.id, "t", tempStorage().storage);
    expect(a.status).toBe("AWAITING_REVIEW");
    expect(a.outcome).toBeNull();
  });
});
