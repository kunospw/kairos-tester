// Structured AI output schemas, prompt builders and post-validation.
// Pure module (no server/DB imports) so it can be unit tested.

import { z } from "zod";

const str = z.string().trim();
const strList = z.array(z.coerce.string().trim()).default([]);

const priority = z.preprocess(
  (v) => {
    const s = String(v ?? "").toLowerCase();
    if (s.startsWith("h") || s === "critical") return "HIGH";
    if (s.startsWith("m")) return "MEDIUM";
    if (s.startsWith("l")) return "LOW";
    return v;
  },
  z.enum(["HIGH", "MEDIUM", "LOW"]),
);

const mode = z.preprocess(
  (v) => String(v ?? "").toUpperCase(),
  z.enum(["MANUAL", "AUTOMATED", "HYBRID"]),
);

const step = z.union([
  str.min(1).transform((text) => ({ text, required: true })),
  z.object({ text: str.min(1), required: z.boolean().default(true) }),
]);

export const draftedCaseSchema = z.object({
  title: str.min(1).max(500),
  section: str.max(300).default(""),
  role: str.max(300).default(""),
  preconditions: str.max(5000).default(""),
  steps: z.array(step).min(1).max(40),
  testData: str.max(5000).default(""),
  expectedChecks: z.array(str.min(1)).min(1).max(40),
  priority,
  proposedExecutionMode: mode,
  sourceReferences: strList,
  assumptions: strList,
  openQuestions: strList,
});
export type DraftedCase = z.infer<typeof draftedCaseSchema>;

export const draftCasesOutputSchema = z.object({ cases: z.array(draftedCaseSchema).min(1).max(30) });

export const FINDING_TYPES = ["APPLICATION_FAILURE", "BLOCKED_OR_SETUP", "INCOMPLETE_TESTING", "AMBIGUOUS_OR_OUTDATED"] as const;

export const reviewFindingSchema = z.object({
  caseId: str.min(1),
  type: z.preprocess((v) => String(v ?? "").toUpperCase().replace(/[\s-]+/g, "_"), z.enum(FINDING_TYPES)),
  summary: str.min(1).max(2000),
  evidenceQuote: str.max(2000).default(""),
  suggestedAction: str.max(2000).default(""),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export const reviewOutputSchema = z.object({ findings: z.array(reviewFindingSchema).max(200) });

export const reportSummaryOutputSchema = z.object({
  summary: str.min(1).max(6000),
  highlights: strList,
  risks: strList,
  nextSteps: strList,
});
export type ReportSummaryOutput = z.infer<typeof reportSummaryOutputSchema>;

export function formatZodIssues(err: z.ZodError): string[] {
  return err.issues.slice(0, 10).map((i) => `${i.path.join(".") || "output"}: ${i.message}`);
}

// ------------------------------------------------------------------ prompts

const BASE_RULES = `You assist a QA tester. Strict rules:
- Use ONLY the material provided in this message. Do not invent business rules, requirements, screens, source references, screenshots, data, or test results.
- If something is unknown, say so in "assumptions" or "openQuestions" instead of guessing.
- You never decide whether a test passed. Outcomes come only from recorded human or deterministic results.
- Respond with a single JSON object exactly matching the requested shape. No prose outside JSON.`;

export interface ContextItem {
  ref: string; // e.g. CTX-1
  title: string;
  category: string;
  status: string;
  body: string;
}

export function buildDraftCasesMessages(input: {
  applicationName: string;
  requirement: string;
  context: ContextItem[];
  sectionHint?: string | null;
  maxCases: number;
}) {
  const ctx = input.context.length
    ? input.context.map((c) => `[${c.ref}] (${c.category}; ${c.status}) ${c.title}\n${c.body}`).join("\n\n")
    : "(no application context selected)";
  const user = `Application: ${input.applicationName}
Draft up to ${input.maxCases} test cases for the requirement below.${input.sectionHint ? ` Suggested section: ${input.sectionHint}.` : ""}

[REQ] Requirement:
${input.requirement}

Application context:
${ctx}

Allowed source reference keys: REQ${input.context.map((c) => ", " + c.ref).join("")}. Cite only these keys in "sourceReferences".
Context marked UNREVIEWED or OUTDATED may be wrong: record any reliance on it as an assumption.

Return JSON: {"cases":[{"title":string,"section":string,"role":string,"preconditions":string,"steps":[{"text":string,"required":boolean}],"testData":string,"expectedChecks":[string],"priority":"HIGH"|"MEDIUM"|"LOW","proposedExecutionMode":"MANUAL"|"AUTOMATED"|"HYBRID","sourceReferences":[string],"assumptions":[string],"openQuestions":[string]}]}
Propose AUTOMATED only if every check is deterministic; HYBRID if a human must confirm something visually or with external access (e.g. a real inbox).`;
  return [
    { role: "system" as const, content: BASE_RULES },
    { role: "user" as const, content: user },
  ];
}

export interface ReviewCaseInput {
  caseId: string;
  title: string;
  section: string | null;
  preconditions: string | null;
  steps: string | null;
  expected: string | null;
  outcome: string;
  resultSource: string | null;
  notes: string | null;
  reason: string | null;
  actual: string | null;
  partialCoverage: string | null;
}

export function reviewCaseText(c: ReviewCaseInput): string {
  return [
    `Case ${c.caseId}: ${c.title}`,
    c.section && `Section: ${c.section}`,
    c.preconditions && `Preconditions: ${c.preconditions}`,
    c.steps && `Steps:\n${c.steps}`,
    c.expected && `Expected: ${c.expected}`,
    `Recorded result: ${c.outcome}${c.resultSource === "IMPORT" ? " (imported historical record)" : ""}`,
    c.reason && `Reason: ${c.reason}`,
    c.actual && `Actual: ${c.actual}`,
    c.notes && `Notes: ${c.notes}`,
    c.partialCoverage && `Partial coverage noted: ${c.partialCoverage}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReviewMessages(input: { applicationName: string; cycleName: string; cases: ReviewCaseInput[] }) {
  const user = `Application: ${input.applicationName}. Cycle: ${input.cycleName}.
Review these recorded test cases and results. Report only real problems, classified as:
- APPLICATION_FAILURE: the notes describe the application behaving differently from the expected result.
- BLOCKED_OR_SETUP: execution was blocked or setup/data/access was missing (not an application failure).
- INCOMPLETE_TESTING: the recorded result does not cover all expected checks (e.g. Pass but notes say parts were not tested).
- AMBIGUOUS_OR_OUTDATED: the case wording is ambiguous, contradictory, or may be outdated.
Do not change or re-judge results. "evidenceQuote" must be copied verbatim from the case text below, or left empty.
Use the exact case IDs shown.

${input.cases.map(reviewCaseText).join("\n\n---\n\n")}

Return JSON: {"findings":[{"caseId":string,"type":"APPLICATION_FAILURE"|"BLOCKED_OR_SETUP"|"INCOMPLETE_TESTING"|"AMBIGUOUS_OR_OUTDATED","summary":string,"evidenceQuote":string,"suggestedAction":string}]}. Return {"findings":[]} if there are none.`;
  return [
    { role: "system" as const, content: BASE_RULES },
    { role: "user" as const, content: user },
  ];
}

export interface ReportSummaryInput {
  applicationName: string;
  cycleName: string;
  buildLabel: string | null;
  environment: string | null;
  counts: Record<string, number>;
  coverage: string;
  passRate: string;
  partialCoverage: number;
  highPriorityOutstanding: number;
  failed: { id: string; title: string; reason: string | null }[];
  blocked: { id: string; title: string; reason: string | null }[];
  incomplete: { id: string; title: string; note: string }[];
  includedScope: string | null;
  excludedScope: string | null;
}

export function buildReportSummaryMessages(input: ReportSummaryInput) {
  const list = (xs: { id: string; title: string; reason?: string | null; note?: string }[]) =>
    xs.length ? xs.map((x) => `- ${x.id} ${x.title}${x.reason || x.note ? `: ${x.reason ?? x.note}` : ""}`).join("\n") : "- none";
  const user = `Write a short customer-facing summary of these recorded test results. Use only these figures; do not compute new percentages or claim release readiness. Customer acceptance has not been recorded. Mention partial coverage and outstanding high-priority work plainly.

Application: ${input.applicationName}
Cycle: ${input.cycleName}; build: ${input.buildLabel ?? "not recorded"}; environment: ${input.environment ?? "not recorded"}
Included scope: ${input.includedScope ?? "not stated"}
Excluded scope: ${input.excludedScope ?? "not stated"}
Counts: ${Object.entries(input.counts).map(([k, v]) => `${k} ${v}`).join(", ")}
Coverage (Pass+Fail / applicable): ${input.coverage}
Pass rate (Pass / Pass+Fail): ${input.passRate}
Cases with partial coverage flags: ${input.partialCoverage}
High-priority cases not passed: ${input.highPriorityOutstanding}
Failed:
${list(input.failed)}
Blocked:
${list(input.blocked)}
Incomplete coverage flags:
${list(input.incomplete)}

Return JSON: {"summary":string,"highlights":[string],"risks":[string],"nextSteps":[string]}`;
  return [
    { role: "system" as const, content: BASE_RULES },
    { role: "user" as const, content: user },
  ];
}

// ------------------------------------------------------------------ post-validation

export interface ValidatedDraft extends DraftedCase {
  validationWarnings: string[];
}

/** Remove source references that were not supplied, and record a warning. */
export function validateDraftedCases(cases: DraftedCase[], allowedRefs: string[]): ValidatedDraft[] {
  const allowed = new Set(allowedRefs.map((r) => r.toUpperCase()));
  return cases.map((c) => {
    const warnings: string[] = [];
    const refs = c.sourceReferences.map((r) => r.replace(/^\[|\]$/g, "").trim());
    const bad = refs.filter((r) => !allowed.has(r.toUpperCase()));
    if (bad.length) warnings.push(`Removed source reference(s) that were not provided: ${bad.join(", ")}.`);
    const good = refs.filter((r) => allowed.has(r.toUpperCase()));
    if (good.length === 0) warnings.push("No supporting source reference. Verify against the requirement before accepting.");
    return { ...c, sourceReferences: good, validationWarnings: warnings };
  });
}

const squash = (s: string) => s.toLowerCase().replace(/[\s"'“”‘’]+/g, " ").trim();

export interface ValidatedFinding extends ReviewFinding {
  validationWarnings: string[];
}

/** Drop findings for cases that were not submitted; check quotes really appear in the submitted text. */
export function validateFindings(findings: ReviewFinding[], submitted: Map<string, string>) {
  const kept: ValidatedFinding[] = [];
  const dropped: string[] = [];
  for (const f of findings) {
    const key = [...submitted.keys()].find((k) => k.toLowerCase() === f.caseId.toLowerCase());
    if (!key) {
      dropped.push(f.caseId);
      continue;
    }
    const warnings: string[] = [];
    if (f.evidenceQuote && !squash(submitted.get(key)!).includes(squash(f.evidenceQuote))) {
      warnings.push("The quoted evidence does not appear in the submitted case text. Verify before accepting.");
    }
    kept.push({ ...f, caseId: key, validationWarnings: warnings });
  }
  return { findings: kept, droppedCaseIds: dropped };
}
