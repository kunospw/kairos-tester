// Report snapshots freeze the computed results of a cycle at a point in time,
// so a customer-facing report does not change when later attempts are added.

import { z } from "zod";
import Papa from "papaparse";
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { badRequest, notFound } from "@/server/errors";
import { loadCycleResults } from "@/server/services/results";
import { dbDateToIso } from "@/lib/dates";
import { OUTCOME_LABEL, PRIORITY_LABEL, FINDING_TYPE_LABEL, type OutcomeValue, type PriorityValue } from "@/lib/domain";
import type { Metrics } from "@/lib/metrics";

export interface ReportCase {
  cycleCaseId: string;
  externalId: string;
  title: string;
  section: string | null;
  priority: PriorityValue;
  role: string | null;
  versionNumber: number;
  outcome: OutcomeValue;
  lifecycle: string | null;
  expected: string | null;
  actual: string | null;
  reason: string | null;
  remarks: string | null;
  tester: string | null;
  executedOn: string | null;
  source: string | null;
  executionMethod: string | null;
  attemptNumber: number | null;
  attemptCount: number;
  partialCoverage: boolean;
  partialCoverageNote: string | null;
  flags: { type: string; message: string; source: string }[];
  evidence: { id: string; name: string; mimeType: string; caption: string | null }[];
}

export interface ReportData {
  schemaVersion: 1;
  generatedAt: string;
  application: { id: string; name: string };
  cycle: { id: string; name: string; kind: string; buildLabel: string | null; scope: string | null; excludedScope: string | null };
  environment: { name: string; type: string; targetUrl: string | null } | null;
  metrics: Metrics;
  bySection: { section: string; metrics: Metrics }[];
  cases: ReportCase[];
}

export const newReportSchema = z.object({
  cycleId: z.string(),
  title: z.string().trim().min(1).max(300),
  includedScope: z.string().trim().max(5000).nullish(),
  excludedScope: z.string().trim().max(5000).nullish(),
});

export async function buildReportData(db: Db, cycleId: string): Promise<ReportData> {
  const res = await loadCycleResults(db, cycleId);
  if (res.simulation) throw badRequest("Simulation cycles cannot be reported. Simulated results never appear in reports.");
  const attemptIds = res.rows.map((r) => r.latestCompleted?.id).filter((x): x is string => Boolean(x));
  const evidence = await db.evidence.findMany({
    where: { attemptId: { in: attemptIds }, isSimulated: false },
    orderBy: { createdAt: "asc" },
  });
  const byAttempt = new Map<string, typeof evidence>();
  for (const e of evidence) byAttempt.set(e.attemptId, [...(byAttempt.get(e.attemptId) ?? []), e]);

  const cases: ReportCase[] = res.rows.map((r) => {
    const a = r.latestCompleted;
    return {
      cycleCaseId: r.cycleCaseId,
      externalId: r.externalId,
      title: r.version.title,
      section: r.section,
      priority: r.priority,
      role: r.role,
      versionNumber: r.version.versionNumber,
      outcome: r.outcome,
      lifecycle: r.lifecycle,
      expected: r.version.expectedResult,
      actual: a?.actualResult ?? null,
      reason: a?.outcomeReason ?? null,
      remarks: a?.remarks ?? null,
      tester: a?.tester ?? null,
      executedOn: dbDateToIso(a?.executedOn ?? null),
      source: a?.source ?? null,
      executionMethod: a?.executionMethod ?? null,
      attemptNumber: a?.attemptNumber ?? null,
      attemptCount: r.attemptCount,
      partialCoverage: a?.partialCoverage ?? false,
      partialCoverageNote: a?.partialCoverageNote ?? null,
      flags: r.openFindings.map((f) => ({ type: f.type, message: f.message, source: f.source })),
      evidence: (a ? (byAttempt.get(a.id) ?? []) : []).map((e) => ({
        id: e.id,
        name: e.originalName,
        mimeType: e.mimeType,
        caption: e.caption,
      })),
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    application: { id: res.cycle.application.id, name: res.cycle.application.name },
    cycle: {
      id: res.cycle.id,
      name: res.cycle.name,
      kind: res.cycle.kind,
      buildLabel: res.cycle.buildLabel,
      scope: res.cycle.scope,
      excludedScope: res.cycle.excludedScope,
    },
    environment: res.cycle.environment
      ? { name: res.cycle.environment.name, type: res.cycle.environment.type, targetUrl: res.cycle.environment.targetUrl }
      : null,
    metrics: res.metrics,
    bySection: res.bySection,
    cases,
  };
}

export async function createReport(db: Db, applicationId: string, input: z.infer<typeof newReportSchema>, user: string) {
  const cycle = await db.testCycle.findFirst({ where: { id: input.cycleId, applicationId } });
  if (!cycle) throw notFound("Cycle not found in this application.");
  const data = await buildReportData(db, cycle.id);
  return db.reportSnapshot.create({
    data: {
      cycleId: cycle.id,
      title: input.title,
      includedScope: input.includedScope || cycle.scope,
      excludedScope: input.excludedScope || cycle.excludedScope,
      data: data as unknown as Prisma.InputJsonValue,
      createdBy: user,
    },
  });
}

export function reportCsv(report: { title: string; data: unknown }): string {
  const data = report.data as ReportData;
  const rows = data.cases.map((c) => ({
    "Case ID": c.externalId,
    Section: c.section ?? "",
    Title: c.title,
    Priority: PRIORITY_LABEL[c.priority],
    Result: OUTCOME_LABEL[c.outcome],
    "In progress": c.lifecycle ?? "",
    "Expected result": c.expected ?? "",
    "Actual result": c.actual ?? "",
    "Reason (Fail/Blocked/N/A)": c.reason ?? "",
    "Notes / remarks": c.remarks ?? "",
    "Partial coverage": c.partialCoverage ? `Yes: ${c.partialCoverageNote ?? ""}` : "",
    "Review flags": c.flags.map((f) => `${FINDING_TYPE_LABEL[f.type] ?? f.type}: ${f.message}`).join(" | "),
    Tester: c.tester ?? "",
    "Executed on": c.executedOn ?? "",
    "Result source": c.source === "IMPORT" ? "Imported historical result" : (c.source ?? ""),
    "Execution method": c.executionMethod ?? "",
    "Case version": c.versionNumber,
    Attempts: c.attemptCount,
    "Evidence files": c.evidence.map((e) => e.name).join("; "),
  }));
  // Prefix cells that look like formulas so spreadsheet apps don't execute them.
  const safe = rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v])),
  );
  return "﻿" + Papa.unparse(safe, { newline: "\r\n" });
}
