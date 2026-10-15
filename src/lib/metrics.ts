// Metric definitions (computed from case/result records, never cached cells):
//   Applicable   = all assigned cases except N/A
//   Coverage     = (Pass + Fail) / Applicable
//   Pass rate    = Pass / (Pass + Fail)
// Not run and Blocked are reported separately. A zero denominator yields null
// so the UI shows "No completed tests" instead of a misleading percentage.

import type { OutcomeValue, PriorityValue } from "@/lib/domain";

export interface ResultRow {
  section: string | null;
  priority: PriorityValue;
  /** Outcome of the latest completed attempt, or NOT_RUN if none. */
  outcome: OutcomeValue;
  partialCoverage: boolean;
  openIncompleteFlags: number;
}

export interface OutcomeCounts {
  total: number;
  PASS: number;
  FAIL: number;
  BLOCKED: number;
  NOT_RUN: number;
  NOT_APPLICABLE: number;
}

export interface Metrics extends OutcomeCounts {
  applicable: number;
  completed: number;
  coverage: number | null;
  passRate: number | null;
  partialCoverage: number;
  highPriorityOutstanding: number;
}

export function emptyCounts(): OutcomeCounts {
  return { total: 0, PASS: 0, FAIL: 0, BLOCKED: 0, NOT_RUN: 0, NOT_APPLICABLE: 0 };
}

export function computeMetrics(rows: ResultRow[]): Metrics {
  const c = emptyCounts();
  let partial = 0;
  let highOutstanding = 0;
  for (const r of rows) {
    c.total++;
    c[r.outcome]++;
    if (r.partialCoverage || r.openIncompleteFlags > 0) partial++;
    if (r.priority === "HIGH" && r.outcome !== "PASS" && r.outcome !== "NOT_APPLICABLE") highOutstanding++;
  }
  const applicable = c.total - c.NOT_APPLICABLE;
  const completed = c.PASS + c.FAIL;
  return {
    ...c,
    applicable,
    completed,
    coverage: applicable > 0 ? completed / applicable : null,
    passRate: completed > 0 ? c.PASS / completed : null,
    partialCoverage: partial,
    highPriorityOutstanding: highOutstanding,
  };
}

export function metricsBySection(rows: ResultRow[]): { section: string; metrics: Metrics }[] {
  const order: string[] = [];
  const groups = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const key = r.section ?? "(no section)";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  }
  return order.map((section) => ({ section, metrics: computeMetrics(groups.get(section)!) }));
}

export function formatPercent(value: number | null, emptyLabel = "No completed tests"): string {
  if (value === null) return emptyLabel;
  return `${(value * 100).toFixed(1)}%`;
}
