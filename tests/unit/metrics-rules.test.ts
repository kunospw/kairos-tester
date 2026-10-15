import { describe, it, expect } from "vitest";
import { computeMetrics, metricsBySection, formatPercent, type ResultRow } from "@/lib/metrics";
import { validateCompletion, type CompletionInput } from "@/lib/execution-rules";
import { splitSteps, parseOutcome } from "@/lib/domain";
import { toIsoDate, isoDateToDbDate, dbDateToIso, formatDateOnly, excelSerialToIsoDate } from "@/lib/dates";

const row = (outcome: ResultRow["outcome"], extra: Partial<ResultRow> = {}): ResultRow => ({
  section: "S1",
  priority: "MEDIUM",
  outcome,
  partialCoverage: false,
  openIncompleteFlags: 0,
  ...extra,
});

describe("metrics", () => {
  it("computes coverage and pass rate per the documented definitions, excluding N/A", () => {
    const m = computeMetrics([row("PASS"), row("PASS"), row("FAIL"), row("BLOCKED"), row("NOT_RUN"), row("NOT_APPLICABLE")]);
    expect(m.total).toBe(6);
    expect(m.applicable).toBe(5);
    expect(m.completed).toBe(3);
    expect(m.coverage).toBeCloseTo(3 / 5);
    expect(m.passRate).toBeCloseTo(2 / 3);
    expect(m.BLOCKED).toBe(1);
    expect(m.NOT_RUN).toBe(1);
  });

  it("returns null (not 0% or 100%) when a denominator is zero", () => {
    const m = computeMetrics([row("NOT_RUN"), row("BLOCKED")]);
    expect(m.passRate).toBeNull();
    expect(m.coverage).toBe(0);
    expect(formatPercent(m.passRate)).toBe("No completed tests");
    const allNa = computeMetrics([row("NOT_APPLICABLE")]);
    expect(allNa.coverage).toBeNull();
    expect(computeMetrics([]).coverage).toBeNull();
  });

  it("counts partial coverage and high-priority outstanding separately", () => {
    const m = computeMetrics([
      row("PASS", { openIncompleteFlags: 1, priority: "HIGH" }),
      row("PASS", { partialCoverage: true }),
      row("BLOCKED", { priority: "HIGH" }),
      row("NOT_APPLICABLE", { priority: "HIGH" }),
    ]);
    expect(m.partialCoverage).toBe(2);
    expect(m.highPriorityOutstanding).toBe(1);
    expect(m.passRate).toBe(1); // a green rate, but partial coverage is still reported
  });

  it("groups by section in first-seen order", () => {
    const groups = metricsBySection([row("PASS", { section: "B" }), row("FAIL", { section: "A" }), row("PASS", { section: "B" })]);
    expect(groups.map((g) => g.section)).toEqual(["B", "A"]);
    expect(groups[0].metrics.PASS).toBe(2);
  });
});

describe("execution completion rules", () => {
  const base: CompletionInput = {
    outcome: "PASS",
    steps: [
      { text: "Open page", required: true, result: "PASS" },
      { text: "Check expiry", required: true, result: "NOT_RUN" },
    ],
    partialCoverage: false,
    executionMode: "MANUAL",
    humanCheckpointConfirmed: false,
    tester: "dyah",
  };

  it("unfinished required checks prevent Pass", () => {
    expect(validateCompletion(base).join(" ")).toMatch(/Cannot mark Pass: 1 required check/);
    const ok = validateCompletion({ ...base, steps: base.steps.map((s) => ({ ...s, result: "PASS" as const })) });
    expect(ok).toEqual([]);
  });

  it("optional unfinished checks do not prevent Pass", () => {
    const errs = validateCompletion({
      ...base,
      steps: [base.steps[0], { text: "Optional", required: false, result: "NOT_RUN" }],
    });
    expect(errs).toEqual([]);
  });

  it("requires reasons for Fail, Blocked and N/A", () => {
    for (const outcome of ["FAIL", "BLOCKED", "NOT_APPLICABLE"] as const) {
      expect(validateCompletion({ ...base, outcome }).join(" ")).toMatch(/reason is required/);
      expect(validateCompletion({ ...base, outcome, outcomeReason: "Because" })).toEqual([]);
    }
  });

  it("rejects Not run as a completed result", () => {
    expect(validateCompletion({ ...base, outcome: "NOT_RUN" }).join(" ")).toMatch(/not a completed result/);
  });

  it("requires a partial-coverage explanation", () => {
    const steps = base.steps.map((s) => ({ ...s, result: "PASS" as const }));
    expect(validateCompletion({ ...base, steps, partialCoverage: true }).join(" ")).toMatch(/Explain what was not covered/);
  });

  it("hybrid tests need a human checkpoint before completion", () => {
    const steps = base.steps.map((s) => ({ ...s, result: "PASS" as const }));
    expect(validateCompletion({ ...base, steps, executionMode: "HYBRID" }).join(" ")).toMatch(/human checkpoint/);
    expect(validateCompletion({ ...base, steps, executionMode: "HYBRID", humanCheckpointConfirmed: true })).toEqual([]);
  });
});

describe("domain helpers", () => {
  it("splits numbered steps and keeps continuation lines", () => {
    expect(splitSteps("1. Open /login.\n2. Enter email\n   and click Send.\n3) Sign in")).toEqual([
      "Open /login.",
      "Enter email\nand click Send.",
      "Sign in",
    ]);
    expect(splitSteps("Just one instruction")).toEqual(["Just one instruction"]);
  });

  it("parses supported outcomes only", () => {
    expect(parseOutcome("N/A")).toBe("NOT_APPLICABLE");
    expect(parseOutcome(" not run ")).toBe("NOT_RUN");
    expect(parseOutcome("")).toBe("NOT_RUN");
    expect(parseOutcome("Done")).toBeNull();
  });
});

describe("date-only handling", () => {
  it("round-trips through the DB representation without shifting", () => {
    const d = isoDateToDbDate("2026-10-12");
    expect(d.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(dbDateToIso(d)).toBe("2026-10-12");
    expect(formatDateOnly(d)).toBe("12 Oct 2026");
  });

  it("rejects impossible dates", () => {
    expect(toIsoDate("31/02/2026")).toBeNull();
    expect(toIsoDate("")).toBeUndefined();
    expect(excelSerialToIsoDate(46307)).toBe("2026-10-12");
    expect(excelSerialToIsoDate(-5)).toBeNull();
  });
});
