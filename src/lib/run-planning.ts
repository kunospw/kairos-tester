// Decides, before a run starts, which cases the AI can run, which need a person,
// and which are not allowed on this environment. Deterministic and explainable.

export type Plan = "AUTOMATABLE" | "NEEDS_HUMAN" | "NOT_ALLOWED";

export interface PlanInput {
  externalId: string;
  title: string;
  environment: string | null;
  preconditions: string | null;
  stepsText: string | null;
  expectedResult: string | null;
}

export interface PlanContext {
  /** Environment names (from cases) the runner can reach, e.g. ["Demo"]. Others need a person. */
  reachableEnvironments: string[];
  disposable: boolean;
  /** Sign-in codes can be read without a real inbox (email_code_outbox profile). */
  codesWithoutInbox: boolean;
}

const HUMAN_ONLY: [RegExp, string][] = [
  [/\bwait (up to |about |at least )?(\d+|an?|a few|several) (minutes?|hours?)\b/i, "needs a long real-time wait"],
  [/\breal (inbox|mailbox|email)\b/i, "needs a real email inbox"],
  [/\b(by eye|visually|colour|color)\b/i, "needs a person to judge visually"],
  [/\b(print|printed|paper|phone|sms|mobile device)\b/i, "needs something outside the browser"],
  [/\b(file'?s? (size|properties|orientation)|exif|gps data)\b/i, "needs a downloaded file inspected"],
  [/\bdevtools|console\b/i, "needs crafted requests from the browser console"],
  [/\b(restart|redeploy|reboot)\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\s*=/, "needs the application restarted or its configuration changed"],
];

const DESTRUCTIVE = /\b(delete|deletes|deleted|archive|archived|purge|remove|removes|reset|test load|load \(test\)|wipe)\b/i;

export function planCase(c: PlanInput, ctx: PlanContext): { plan: Plan; reason: string | null } {
  const text = [c.title, c.preconditions, c.stepsText, c.expectedResult].filter(Boolean).join("\n");
  if (c.environment && ctx.reachableEnvironments.length > 0 && !ctx.reachableEnvironments.some((e) => e.toLowerCase() === c.environment!.toLowerCase())) {
    return { plan: "NEEDS_HUMAN", reason: `Runs on ${c.environment}, which the AI runner cannot reach.` };
  }
  for (const [re, why] of HUMAN_ONLY) {
    if (re.test(text)) return { plan: "NEEDS_HUMAN", reason: `This case ${why}.` };
  }
  if (!ctx.codesWithoutInbox && /\bcode (from|in) the email\b/i.test(text)) {
    return { plan: "NEEDS_HUMAN", reason: "This case needs a sign-in code from a real inbox." };
  }
  if (DESTRUCTIVE.test(text) && !ctx.disposable) {
    return { plan: "NOT_ALLOWED", reason: "Creates or deletes data, and this environment is not marked as disposable." };
  }
  return { plan: "AUTOMATABLE", reason: null };
}

/** True if a case removes, archives, deletes or resets things (it may break shared test data). */
export function changesSharedData(c: Pick<PlanInput, "title" | "stepsText" | "expectedResult">): boolean {
  return /\b(delete|deletes|deleted|archive|archived|purge|remove|removes|reset|wipe)\b/i.test([c.title, c.stepsText].filter(Boolean).join("\n"));
}

/**
 * Run order: keep checklist order, but move data-destroying cases after the
 * rest so they cannot break the data later cases rely on.
 */
export function orderForRun<T extends { title: string; stepsText: string | null; expectedResult: string | null }>(cases: T[]): T[] {
  const safe = cases.filter((c) => !changesSharedData(c));
  const risky = cases.filter((c) => changesSharedData(c));
  return [...safe, ...risky];
}

/** Case IDs this case depends on, from text like "LD-03 done" in its preconditions. */
export function dependenciesOf(preconditions: string | null, ownId: string): string[] {
  if (!preconditions) return [];
  const ids = preconditions.match(/\b[A-Z]{2,4}-\d{1,3}\b/g) ?? [];
  return [...new Set(ids)].filter((id) => id !== ownId);
}
