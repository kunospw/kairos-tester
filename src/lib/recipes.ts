// Recipes: reviewed, deterministic action sequences the runner tries before
// improvising with the AI. A recipe is only ever created from an ACCEPTED
// AiProposalItem of kind RECIPE; its steps still go through the runner's
// browser guards (localhost only, approved upload folders, protected names).
import { z } from "zod";
import { agentActionSchema } from "@/lib/agent-protocol";

const str = z.string().trim();

/** Run events starting with this hold an item's action log (input for recipe drafting); hidden from the live feed. */
export const ACTIONS_PREFIX = "[actions] ";

/** Only plain browser actions may appear in a recipe: no verdicts, no questions, no step bookkeeping. */
const RECIPE_ACTION_TYPES = ["act_as", "goto", "click", "fill", "select", "press", "upload", "wait", "screenshot"] as const;

export const recipeStepSchema = agentActionSchema.refine((a) => (RECIPE_ACTION_TYPES as readonly string[]).includes(a.type), {
  message: `Recipe steps may only use: ${RECIPE_ACTION_TYPES.join(", ")}.`,
});

export const recipeCheckSchema = agentActionSchema.refine((a) => a.type === "check", { message: "Success checks must be check actions." });

/** All given patterns must match (case-insensitive). At least one is required. */
export const matchRuleSchema = z
  .object({
    titlePattern: str.max(200).optional(),
    sectionPattern: str.max(200).optional(),
    externalIdPattern: str.max(200).optional(),
  })
  .refine((m) => Boolean(m.titlePattern || m.sectionPattern || m.externalIdPattern), { message: "Give at least one match pattern." })
  .refine(
    (m) =>
      [m.titlePattern, m.sectionPattern, m.externalIdPattern].every((p) => {
        if (!p) return true;
        try {
          new RegExp(p, "i");
          return true;
        } catch {
          return false;
        }
      }),
    { message: "A match pattern is not a valid regular expression." },
  );
export type MatchRule = z.infer<typeof matchRuleSchema>;

/** Models often leave out a check's description; derive one from the check so a good draft is not lost. */
function withDescriptions(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((c) => {
    if (!c || typeof c !== "object" || (c as { description?: unknown }).description) return c;
    const k = c as { kind?: string; text?: string; name?: string; role?: string };
    const what = k.text ?? [k.role, k.name && `"${k.name}"`].filter(Boolean).join(" ");
    return { ...c, description: `${(k.kind ?? "check").replace(/_/g, " ")}${what ? `: ${what}` : ""}` };
  });
}

/** What the AI proposes (and the reviewer may edit) before it becomes a Recipe. */
export const recipeDraftSchema = z.object({
  name: str.min(3).max(120),
  explanation: str.min(1).max(2000),
  scope: z.enum(["SETUP", "TEST", "ALL"]).default("ALL"),
  priority: z.number().int().min(0).max(100).default(0),
  matchRule: matchRuleSchema,
  steps: z.array(recipeStepSchema).min(1).max(40),
  successChecks: z.preprocess(withDescriptions, z.array(recipeCheckSchema).min(1).max(10)),
});
export type RecipeDraft = z.infer<typeof recipeDraftSchema>;

export interface CaseFacts {
  externalId: string;
  title: string;
  section: string | null;
  purpose: "TEST" | "SETUP";
}

export function ruleMatches(rule: MatchRule, c: CaseFacts): boolean {
  const test = (p: string | undefined, value: string | null) => !p || new RegExp(p, "i").test(value ?? "");
  return test(rule.titlePattern, c.title) && test(rule.sectionPattern, c.section) && test(rule.externalIdPattern, c.externalId);
}

export interface StoredRecipe {
  id: string;
  name: string;
  scope: "SETUP" | "TEST" | "ALL";
  priority: number;
  environmentId: string | null;
  matchRule: unknown;
  steps: unknown;
  successChecks: unknown;
}

/** Best active recipe for this case: scope fits, rule matches, highest priority, then most specific rule. */
export function pickRecipe(recipes: StoredRecipe[], c: CaseFacts, environmentId: string) {
  const fits = recipes
    .filter((r) => r.scope === "ALL" || r.scope === c.purpose)
    .filter((r) => !r.environmentId || r.environmentId === environmentId)
    .flatMap((r) => {
      const rule = matchRuleSchema.safeParse(r.matchRule);
      const steps = z.array(recipeStepSchema).safeParse(r.steps);
      const checks = z.array(recipeCheckSchema).safeParse(r.successChecks);
      if (!rule.success || !steps.success || !checks.success || !ruleMatches(rule.data, c)) return [];
      const specificity = Object.values(rule.data).filter(Boolean).length;
      return [{ id: r.id, name: r.name, priority: r.priority, specificity, steps: steps.data, checks: checks.data }];
    })
    .sort((a, b) => b.priority - a.priority || b.specificity - a.specificity);
  return fits[0] ?? null;
}
