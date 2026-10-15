// Shared domain vocabulary. Kept free of Prisma imports so it can be used in
// client components and unit tests. Values mirror the Prisma enums.

export const OUTCOMES = ["PASS", "FAIL", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE"] as const;
export type OutcomeValue = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<OutcomeValue, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  BLOCKED: "Blocked",
  NOT_RUN: "Not run",
  NOT_APPLICABLE: "N/A",
};

/** Outcomes that need a written reason when recorded through this app. */
export const OUTCOMES_REQUIRING_REASON: OutcomeValue[] = ["FAIL", "BLOCKED", "NOT_APPLICABLE"];

export const ATTEMPT_STATUSES = ["DRAFT", "RUNNING", "AWAITING_REVIEW", "COMPLETED"] as const;
export type AttemptStatusValue = (typeof ATTEMPT_STATUSES)[number];
export const ATTEMPT_STATUS_LABEL: Record<AttemptStatusValue, string> = {
  DRAFT: "Draft",
  RUNNING: "Running",
  AWAITING_REVIEW: "Awaiting review",
  COMPLETED: "Completed",
};

export const EXECUTION_MODES = ["UNKNOWN", "MANUAL", "AUTOMATED", "HYBRID"] as const;
export type ExecutionModeValue = (typeof EXECUTION_MODES)[number];
export const EXECUTION_MODE_LABEL: Record<ExecutionModeValue, string> = {
  UNKNOWN: "Unknown (not reviewed)",
  MANUAL: "Manual",
  AUTOMATED: "Automated",
  HYBRID: "Hybrid",
};

export const EXECUTION_METHOD_LABEL: Record<string, string> = {
  UNKNOWN: "Unknown",
  MANUAL: "Manual",
  AUTOMATED: "Automated",
  HYBRID: "Hybrid",
  SIMULATED: "Simulated",
  AI_DRIVEN: "AI-driven (human-reviewed)",
};

export const ATTEMPT_SOURCE_LABEL: Record<string, string> = {
  IMPORT: "Imported historical record",
  MANUAL: "Recorded here",
  RUNNER: "Automation runner",
  SIMULATION: "SIMULATED",
  AI_AGENT: "AI agent run",
};

export const PRIORITIES = ["HIGH", "MEDIUM", "LOW", "UNSET"] as const;
export type PriorityValue = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<PriorityValue, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNSET: "Not set",
};

export const SUGGESTED_CATEGORIES = [
  "regression",
  "acceptance",
  "smoke",
  "negative scenario",
  "security",
  "data integrity",
  "permissions",
] as const;

export const FINDING_TYPE_LABEL: Record<string, string> = {
  APPLICATION_FAILURE: "Application failure",
  BLOCKED_OR_SETUP: "Missing setup / blocked execution",
  INCOMPLETE_TESTING: "Incomplete coverage requiring review",
  AMBIGUOUS_OR_OUTDATED: "Ambiguous or potentially outdated requirement",
};

export const CONTEXT_CATEGORY_LABEL: Record<string, string> = {
  ROLES_PERMISSIONS: "Roles and permissions",
  BUSINESS_WORKFLOWS: "Business workflows",
  BUSINESS_RULES: "Business rules",
  TECHNICAL_DETAILS: "Technical details and verification sources",
  REQUIREMENTS_REFERENCES: "Requirements and references",
  CONSTRAINTS_GAPS: "Constraints and known gaps",
};

export const CYCLE_KIND_LABEL: Record<string, string> = {
  STANDARD: "Test round",
  HISTORICAL_IMPORT: "Historical (imported)",
  SIMULATION: "Simulation demo (not real results)",
};

/** Parse a free-text outcome from a spreadsheet. Blank means Not run. */
export function parseOutcome(input: unknown): OutcomeValue | null {
  const s = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  if (s === "") return "NOT_RUN";
  switch (s) {
    case "pass":
    case "passed":
      return "PASS";
    case "fail":
    case "failed":
      return "FAIL";
    case "blocked":
      return "BLOCKED";
    case "not run":
    case "notrun":
    case "not tested":
      return "NOT_RUN";
    case "n/a":
    case "na":
    case "not applicable":
      return "NOT_APPLICABLE";
    default:
      return null;
  }
}

export function parsePriority(input: unknown): PriorityValue | null {
  const s = String(input ?? "").trim().toLowerCase();
  if (s === "") return "UNSET";
  if (["high", "h", "p1", "critical"].includes(s)) return "HIGH";
  if (["med", "medium", "m", "p2"].includes(s)) return "MEDIUM";
  if (["low", "l", "p3"].includes(s)) return "LOW";
  return null;
}

/** Split numbered multi-line steps ("1. Do x\n2. Do y") into individual checks. */
export function splitSteps(stepsText: string | null | undefined): string[] {
  if (!stepsText) return [];
  const lines = stepsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const steps: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)[.)]\s*(.*)$/);
    if (m || steps.length === 0) steps.push(m ? m[2] : line);
    else steps[steps.length - 1] += "\n" + line; // continuation line
  }
  return steps;
}
