// Read model for cycle results. The effective result of a cycle case is the
// outcome of its latest COMPLETED attempt; with no completed attempt it is
// Not run. Unfinished attempts are reported as a lifecycle state alongside.
//
// Simulated attempts are only ever read for SIMULATION cycles; real cycles
// filter them out defensively even though they should never exist there.

import type { Db } from "@/server/db";
import type { OutcomeValue, PriorityValue } from "@/lib/domain";
import { computeMetrics, metricsBySection, type ResultRow } from "@/lib/metrics";

export async function loadCycleResults(db: Db, cycleId: string) {
  const cycle = await db.testCycle.findUniqueOrThrow({
    where: { id: cycleId },
    include: { environment: true, application: true },
  });
  const simulation = cycle.kind === "SIMULATION";
  const ccs = await db.cycleCase.findMany({
    where: { cycleId },
    orderBy: { sortOrder: "asc" },
    include: {
      testCase: { include: { automation: true } },
      caseVersion: true,
      attempts: {
        where: simulation ? {} : { isSimulated: false },
        orderBy: { attemptNumber: "desc" },
        include: { _count: { select: { evidence: true } } },
      },
      findings: { where: { status: "OPEN" } },
    },
  });

  const rows = ccs.map((cc) => {
    const latest = cc.attempts[0] ?? null;
    const latestCompleted = cc.attempts.find((a) => a.status === "COMPLETED") ?? null;
    const outcome: OutcomeValue = (latestCompleted?.outcome as OutcomeValue | null) ?? "NOT_RUN";
    const openIncomplete = cc.findings.filter((f) => f.type === "INCOMPLETE_TESTING").length;
    return {
      cycleCaseId: cc.id,
      testCaseId: cc.testCaseId,
      externalId: cc.testCase.externalId,
      version: cc.caseVersion,
      section: cc.caseVersion.section,
      priority: cc.caseVersion.priority as PriorityValue,
      role: cc.caseVersion.role,
      environment: cc.caseVersion.environment,
      executionMode: cc.caseVersion.executionMode,
      outcome,
      lifecycle: latest && latest.status !== "COMPLETED" ? latest.status : null,
      latestAttempt: latest,
      latestCompleted,
      attemptCount: cc.attempts.length,
      evidenceCount: cc.attempts.reduce((n, a) => n + a._count.evidence, 0),
      partialCoverage: latestCompleted?.partialCoverage ?? false,
      openFindings: cc.findings,
      openIncompleteFlags: openIncomplete,
      automation: cc.testCase.automation,
      importNotes: cc.importNotes,
    };
  });

  const resultRows: ResultRow[] = rows.map((r) => ({
    section: r.section,
    priority: r.priority,
    outcome: r.outcome,
    partialCoverage: r.partialCoverage,
    openIncompleteFlags: r.openIncompleteFlags,
  }));

  return {
    cycle,
    simulation,
    rows,
    metrics: computeMetrics(resultRows),
    bySection: metricsBySection(resultRows),
  };
}

export type CycleResults = Awaited<ReturnType<typeof loadCycleResults>>;
export type CycleResultRow = CycleResults["rows"][number];

/** Non-simulation cycles for an application, newest first. */
export async function realCycles(db: Db, applicationId: string) {
  return db.testCycle.findMany({
    where: { applicationId, kind: { not: "SIMULATION" } },
    orderBy: { createdAt: "desc" },
    include: { environment: true },
  });
}
