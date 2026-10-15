// The contract between the runner and the model, and the verdict policy.
// The model proposes actions and a verdict; deterministic checks run in the
// browser; the policy below decides what is recorded without a person.
import { z } from "zod";

const str = z.string().trim();

export const agentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sign_in") }),
  z.object({ type: z.literal("read_sign_in_code"), email: str.optional() }),
  z.object({ type: z.literal("act_as"), role: str.min(1) }),
  z.object({ type: z.literal("goto"), path: str.min(1) }),
  z.object({ type: z.literal("click"), role: str.min(1), name: str.min(1), nth: z.number().int().min(0).optional() }),
  z.object({ type: z.literal("fill"), role: str.default("textbox"), name: str.min(1), value: z.string() }),
  z.object({ type: z.literal("select"), name: str.min(1), option: str.min(1) }),
  z.object({ type: z.literal("press"), key: str.min(1) }),
  z.object({ type: z.literal("upload"), file: str.min(1), name: str.optional() }),
  z.object({ type: z.literal("wait"), seconds: z.number().min(0.2).max(10) }),
  z.object({
    type: z.literal("check"),
    kind: z.enum(["text_visible", "text_absent", "url_contains", "element_visible", "element_absent", "element_disabled", "element_enabled"]),
    text: str.optional(),
    role: str.optional(),
    name: str.optional(),
    description: str.min(1),
  }),
  z.object({ type: z.literal("screenshot"), caption: str.min(1) }),
  z.object({ type: z.literal("step_done"), stepIndex: z.number().int().min(0), result: z.enum(["PASS", "FAIL", "BLOCKED"]), note: str.default("") }),
  z.object({ type: z.literal("ask_human"), question: str.min(5) }),
  z.object({
    type: z.literal("finish"),
    verdict: z.enum(["PASS", "FAIL", "BLOCKED"]),
    summary: str.min(1),
    confidence: z.number().min(0).max(1),
  }),
]);
export type AgentAction = z.infer<typeof agentActionSchema>;

export const agentReplySchema = z.object({ thought: z.string().default(""), action: agentActionSchema });

export interface CheckRecord {
  description: string;
  kind: string;
  passed: boolean;
  detail: string;
}

export interface StepRecord {
  stepIndex: number;
  result: "PASS" | "FAIL" | "BLOCKED";
  note: string;
}

export type Decision =
  | { kind: "AUTO_PASS" }
  | { kind: "CONFIRM"; proposed: "PASS" | "FAIL" | "BLOCKED"; why: string };

/**
 * Verdict policy (agreed with the user): passes backed by explicit checks are
 * recorded automatically; fails, blocks and anything uncertain need a person.
 */
export function decide(input: {
  verdict: "PASS" | "FAIL" | "BLOCKED";
  confidence: number;
  checks: CheckRecord[];
  steps: StepRecord[];
  requiredSteps: number[];
  screenshots: number;
}): Decision {
  const { verdict, checks, steps } = input;
  if (verdict !== "PASS") {
    return { kind: "CONFIRM", proposed: verdict, why: verdict === "FAIL" ? "The AI found a failure." : "The AI could not test this." };
  }
  if (checks.length === 0) return { kind: "CONFIRM", proposed: "PASS", why: "No explicit check backs this pass." };
  const failed = checks.filter((c) => !c.passed);
  if (failed.length) return { kind: "CONFIRM", proposed: "FAIL", why: `The AI said pass, but ${failed.length} check(s) failed.` };
  const done = new Map(steps.map((s) => [s.stepIndex, s.result]));
  const missing = input.requiredSteps.filter((i) => done.get(i) !== "PASS");
  if (missing.length) return { kind: "CONFIRM", proposed: "PASS", why: `Step(s) ${missing.map((i) => i + 1).join(", ")} were not confirmed as done.` };
  if (input.confidence < 0.7) return { kind: "CONFIRM", proposed: "PASS", why: `The AI was not confident (${Math.round(input.confidence * 100)}%).` };
  if (input.screenshots === 0) return { kind: "CONFIRM", proposed: "PASS", why: "No screenshot evidence." };
  return { kind: "AUTO_PASS" };
}
