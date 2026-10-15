// Validation rules for recording a new execution attempt in this app.
// Imported historical attempts are NOT validated with these rules; they are
// preserved exactly as recorded and flagged separately.

import { OUTCOMES_REQUIRING_REASON, OUTCOME_LABEL, type OutcomeValue, type ExecutionModeValue } from "@/lib/domain";

export interface StepInput {
  text: string;
  required: boolean;
  result: "PASS" | "FAIL" | "BLOCKED" | "NOT_APPLICABLE" | "NOT_RUN";
}

export interface CompletionInput {
  outcome: OutcomeValue;
  outcomeReason?: string | null;
  steps: StepInput[];
  partialCoverage: boolean;
  partialCoverageNote?: string | null;
  executionMode: ExecutionModeValue;
  /** For hybrid tests: a human has confirmed the manual checkpoints. */
  humanCheckpointConfirmed: boolean;
  tester?: string | null;
}

export function validateCompletion(input: CompletionInput): string[] {
  const errors: string[] = [];
  if (!input.tester?.trim()) errors.push("Tester name is required.");
  if (input.outcome === "NOT_RUN") {
    errors.push("Not run is not a completed result. Save as a draft instead, or choose Blocked/N/A with a reason.");
  }
  if (OUTCOMES_REQUIRING_REASON.includes(input.outcome) && !input.outcomeReason?.trim()) {
    errors.push(`A reason is required for ${OUTCOME_LABEL[input.outcome]}.`);
  }
  if (input.outcome === "PASS") {
    const unfinished = input.steps.filter((s) => s.required && s.result !== "PASS");
    if (unfinished.length > 0) {
      errors.push(
        `Cannot mark Pass: ${unfinished.length} required check(s) are not passed (${unfinished
          .map((s) => `"${truncate(s.text, 40)}"`)
          .join(", ")}). Complete them or record a different result (Fail, Blocked or N/A with a reason).`,
      );
    }
    const failed = input.steps.filter((s) => s.result === "FAIL");
    if (failed.length > 0) errors.push("Cannot mark Pass while a check is marked Fail.");
  }
  if (input.partialCoverage && !input.partialCoverageNote?.trim()) {
    errors.push("Explain what was not covered when flagging partial coverage.");
  }
  if (input.executionMode === "HYBRID" && !input.humanCheckpointConfirmed) {
    errors.push("Hybrid tests need a human checkpoint confirmation before completion. Automated actions alone cannot complete them.");
  }
  return errors;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
