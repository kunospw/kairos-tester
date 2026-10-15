import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, importRows, sampleRows, d } from "./helpers";
import { dbDateToIso } from "@/lib/dates";
import { loadCycleResults } from "@/server/services/results";

const db = testDb();
afterAll(() => db.$disconnect());

let appId: string;
beforeEach(async () => {
  await resetDb(db);
  appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
});

describe("historical import", () => {
  it("saves cases and completed results, keeps sections out of cases, preserves provenance", async () => {
    const res = await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
    expect(res.stats).toMatchObject({ sections: 2, casesCreated: 5, attemptsCreated: 4, notRun: 1, errorRows: 0, incompleteCoverageFlags: 1 });

    const cases = await db.testCase.findMany({ where: { applicationId: appId }, include: { versions: true } });
    expect(cases.map((c) => c.externalId).sort()).toEqual(["AD-01", "AD-02", "SI-01", "SI-02", "SI-03"]);
    expect(cases.every((c) => c.origin === "IMPORT" && c.versions.length === 1)).toBe(true);
    const si01 = cases.find((c) => c.externalId === "SI-01")!.versions[0];
    expect(si01.section).toBe("1. Sign-in & access");
    expect(si01.stepsText).toBe("1. Open /login.\n2. Enter email.\n3. Enter code.");
    expect(si01.executionMode).toBe("UNKNOWN");
    expect(si01.importRowId).not.toBeNull();

    const attempts = await db.executionAttempt.findMany({ include: { cycleCase: { include: { testCase: true } }, importRow: true } });
    expect(attempts).toHaveLength(4);
    for (const a of attempts) {
      expect(a.source).toBe("IMPORT");
      expect(a.executionMethod).toBe("UNKNOWN");
      expect(a.buildLabel).toBeNull();
      expect(a.status).toBe("COMPLETED");
      expect(a.importRow).not.toBeNull();
    }
    const byId = Object.fromEntries(attempts.map((a) => [a.cycleCase.testCase.externalId, a]));
    expect(dbDateToIso(byId["SI-01"].executedOn)).toBe("2026-10-12");
    expect(byId["SI-01"].tester).toBe("dyah");
    expect(byId["AD-01"].outcome).toBe("BLOCKED");
    expect(byId["AD-01"].remarks).toBe("Cloud2 unavailable.");
    expect(await db.stepOutcome.count()).toBe(0);
    expect(await db.evidence.count()).toBe(0);

    // Not run case is assigned but has no attempt.
    const ad02 = await db.cycleCase.findFirst({ where: { testCase: { externalId: "AD-02" } }, include: { attempts: true } });
    expect(ad02!.attempts).toHaveLength(0);

    // Section rows kept as provenance, not as cases.
    expect(await db.importRow.count({ where: { action: "SECTION" } })).toBe(2);
    const raw = (await db.importRow.findFirst({ where: { testCase: { externalId: "SI-02" } } }))!.raw as Record<string, string>;
    expect(raw["Notes / actual"]).toMatch(/not tested/);
  });

  it("flags SI-02 as incomplete coverage but keeps the imported Pass", async () => {
    const res = await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
    const results = await loadCycleResults(db, res.cycleId);
    const si02 = results.rows.find((r) => r.externalId === "SI-02")!;
    expect(si02.outcome).toBe("PASS");
    expect(si02.openFindings).toHaveLength(1);
    expect(si02.openFindings[0]).toMatchObject({ type: "INCOMPLETE_TESTING", source: "IMPORT_RULE" });
    // Metrics are computed from records: 2 Pass, 1 Fail, 1 Blocked, 1 Not run.
    expect(results.metrics).toMatchObject({ total: 5, PASS: 2, FAIL: 1, BLOCKED: 1, NOT_RUN: 1, partialCoverage: 1 });
    expect(results.metrics.passRate).toBeCloseTo(2 / 3);
  });

  it("re-import skips existing IDs by default and never overwrites history", async () => {
    const first = await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
    const again = await importRows(db, appId, sampleRows(), { kind: "existing", cycleId: first.cycleId });
    expect(again.stats).toMatchObject({ casesCreated: 0, casesSkipped: 5, attemptsCreated: 0 });
    expect(await db.testCaseVersion.count()).toBe(5);
    expect(await db.executionAttempt.count()).toBe(4);
  });

  it("reviewed update creates a new version and appends a changed result as a new attempt", async () => {
    const first = await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
    const rows = sampleRows();
    rows[1] = ["SI-01", "K admin", "Demo", "Sign in with a one-time code (v2 wording)", "Portal running.", "1. Open /login.\n2. Enter email.\n3. Enter code.", "Signed in.", "High", "Fail", "dyah", d(2026, 10, 14), "Code email never arrived."];
    const res = await importRows(db, appId, rows, { kind: "existing", cycleId: first.cycleId }, { "SI-01": "update", "SI-03": "update" });
    expect(res.stats.casesUpdated).toBe(1); // SI-01 changed
    expect(res.stats.casesUnchanged).toBe(1); // SI-03 identical
    expect(res.stats.casesSkipped).toBe(3);
    expect(res.stats.attemptsCreated).toBe(1); // only SI-01's changed result
    expect(res.stats.resultsAlreadyRecorded).toBe(1); // SI-03 same result

    const si01 = await db.testCase.findFirstOrThrow({
      where: { externalId: "SI-01" },
      include: { versions: { orderBy: { versionNumber: "asc" } } },
    });
    expect(si01.versions.map((v) => v.title)).toEqual(["Sign in with a one-time code", "Sign in with a one-time code (v2 wording)"]);
    expect(si01.versions[1].source).toBe("IMPORT_UPDATE");
    const attempts = await db.executionAttempt.findMany({
      where: { cycleCase: { testCaseId: si01.id } },
      orderBy: { attemptNumber: "asc" },
    });
    expect(attempts.map((a) => [a.attemptNumber, a.outcome, a.caseVersionId])).toEqual([
      [1, "PASS", si01.versions[0].id],
      [2, "FAIL", si01.versions[1].id],
    ]);
  });

  it("does not import rows with errors, including duplicate IDs within the file", async () => {
    const rows = sampleRows();
    rows.push(["SI-01", "K admin", "Demo", "Duplicate", null, "1. x", "y", "High", "Pass", "a", null, null]);
    rows.push(["SI-09", "K admin", "Demo", "Bad", null, "1. x", "y", "High", "Maybe", "a", null, null]);
    const res = await importRows(db, appId, rows, { kind: "new", name: "Historical" });
    expect(res.stats.errorRows).toBe(2);
    expect(await db.testCase.count()).toBe(5);
    expect(await db.importRow.count({ where: { action: "ERROR" } })).toBe(2);
  });

  it("is transactional: a failure leaves nothing behind", async () => {
    await db.testCycle.create({ data: { applicationId: appId, name: "Taken" } });
    await expect(importRows(db, appId, sampleRows(), { kind: "new", name: "Taken" })).rejects.toThrow(/already exists/);
    expect(await db.testCase.count()).toBe(0);
    expect(await db.importBatch.count()).toBe(0);
    expect(await db.sourceReference.count()).toBe(0);
  });

  it("refuses to import real results into a simulation cycle", async () => {
    const sim = await db.testCycle.create({ data: { applicationId: appId, name: "Sim", kind: "SIMULATION" } });
    await expect(importRows(db, appId, sampleRows(), { kind: "existing", cycleId: sim.id })).rejects.toThrow(/simulation/);
  });
});
