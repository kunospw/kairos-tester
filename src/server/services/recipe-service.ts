// Recipes. The AI only ever drafts a RECIPE proposal; nothing becomes runnable until a
// reviewer accepts it here. Accepted steps still pass the runner's browser guards.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { badRequest, conflict, notFound } from "@/server/errors";
import { aiConfig } from "@/server/ai/ollama";
import type { ChatMessage } from "@/server/ai/ollama";
import { isAllowedUrl, parseProfile, type AgentProfile } from "@/lib/agent-profile";
import { ACTIONS_PREFIX, recipeDraftSchema, type RecipeDraft } from "@/lib/recipes";
import { callStructured, pendingItem, type Prepared } from "@/server/services/ai-service";

export const draftRecipeRequestSchema = z.object({ runItemId: z.string().min(1) });

function uploadable(profile: AgentProfile): string[] {
  const out: string[] = [];
  for (const dir of profile.uploadDirs) {
    try {
      for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).isFile()) out.push(f);
    } catch {
      /* missing folder: nothing to offer */
    }
  }
  return [...new Set(out)].sort();
}

/** Reject anything the runner would refuse anyway, so a reviewer never accepts an unrunnable recipe. */
export function validateRecipeAgainstProfile(draft: RecipeDraft, profile: AgentProfile): string[] {
  const problems: string[] = [];
  const files = uploadable(profile);
  const all = [...draft.steps, ...draft.successChecks];
  for (const [i, a] of all.entries()) {
    if (a.type === "goto" && !isAllowedUrl(profile, new URL(a.path, profile.baseUrl).toString())) problems.push(`Step ${i + 1}: ${a.path} is outside the application under test.`);
    if (a.type === "upload" && !files.includes(path.basename(a.file))) problems.push(`Step ${i + 1}: "${a.file}" is not an approved test file (${files.join(", ") || "none"}).`);
    if (a.type === "act_as" && !(a.role in profile.roleAccounts)) problems.push(`Step ${i + 1}: unknown role "${a.role}".`);
    if (a.type === "fill" && profile.protectedNames.some((n) => n.toLowerCase() === a.value.trim().toLowerCase())) problems.push(`Step ${i + 1}: types a protected name.`);
  }
  return problems;
}

async function loadItem(db: Db, applicationId: string, runItemId: string) {
  const item = await db.runItem.findUnique({
    where: { id: runItemId },
    include: {
      run: { include: { environment: true, cycle: true } },
      cycleCase: { include: { testCase: true, caseVersion: true } },
      attempt: { include: { evidence: { select: { caption: true }, orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!item || item.cycleCase.testCase.applicationId !== applicationId) throw notFound("Run item not found.");
  return item;
}

export async function prepareRecipeDraft(db: Db, applicationId: string, req: z.infer<typeof draftRecipeRequestSchema>) {
  const item = await loadItem(db, applicationId, req.runItemId);
  const profile = parseProfile(item.run.environment.agentProfile);
  if (!profile) throw badRequest("This environment is not set up for the AI runner.");
  const v = item.cycleCase.caseVersion;
  const ext = item.cycleCase.testCase.externalId;
  const log = await db.runEvent.findFirst({
    where: { runItemId: item.id, message: { startsWith: ACTIONS_PREFIX } },
    orderBy: { createdAt: "desc" },
  });
  const actions = log ? log.message.slice(ACTIONS_PREFIX.length) : "(no action log was kept for this item)";
  const steps = ((v.steps as { text: string }[] | null) ?? []).map((s, i) => `${i}. ${s.text}`).join("\n") || v.stepsText || "";
  const system = `You write a RECIPE: a short, deterministic browser script the test runner will follow before it improvises.
Reply with ONE JSON object only:
{"name":"<short name>","explanation":"<what it does and why it is safe to reuse>","scope":"SETUP|TEST|ALL","priority":0-100,
 "matchRule":{"titlePattern":"<regex>","sectionPattern":"<regex, optional>","externalIdPattern":"<regex, optional>"},
 "steps":[...],"successChecks":[...]}

Allowed step objects (nothing else): {"type":"act_as","role"} {"type":"goto","path"} {"type":"click","role","name","nth"} {"type":"fill","role","name","value"} {"type":"select","name","option"} {"type":"press","key"} {"type":"upload","file","name"} {"type":"wait","seconds"} {"type":"screenshot","caption"}.
successChecks: objects {"type":"check","kind":"text_visible|text_absent|url_contains|element_visible|element_absent|element_disabled|element_enabled","text","role","name","description"}. They must prove the flow really worked.
Rules:
- Match by patterns so ONE recipe covers a family of cases (e.g. every upload case), not just this one id.
- Use roles/names exactly as seen in the actions log. Only files from the approved list. Only paths inside the application.
- Never delete, archive or remove anything. Never touch protected names.
- Prefer clicking links/buttons over guessing URLs.`;
  const user = `Case ${ext}: ${v.title}
Section: ${v.section ?? "none"}
Role: ${v.role ?? "not stated"}
Preconditions: ${v.preconditions ?? "none"}
Steps:
${steps}
Expected result: ${v.expectedResult ?? "not stated"}
Run purpose: ${item.purpose}
Roles available: ${Object.keys(profile.roleAccounts).join(", ") || "(signed-in account only)"}
Approved test files: ${uploadable(profile).join(", ") || "none"}
Protected: ${profile.protectedNames.join(", ") || "none"}
Notes about the application: ${profile.notes || "none"}

What happened: ${item.attempt?.actualResult ?? item.statusNote ?? "(no result recorded)"}
${item.attempt?.remarks ? `Checks: ${item.attempt.remarks}\n` : ""}Evidence captions: ${item.attempt?.evidence.map((e) => e.caption).filter(Boolean).join("; ") || "none"}

Actions the AI took (most recent last):
${actions}`;
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const cfg = aiConfig();
  const prepared: Prepared = {
    messages,
    submitted: {
      summary: `Case ${ext}, its steps, the AI's action log, the approved file names and the environment notes.`,
      items: [`${ext}: ${v.title}`, "Action log", "Roles, approved files, protected names, notes"],
      characters: messages.reduce((n, m) => n + m.content.length, 0),
      model: cfg.model,
      endpointHost: new URL(cfg.url).host,
    },
  };
  return { prepared, item, profile };
}

export async function generateRecipeDraft(db: Db, applicationId: string, req: z.infer<typeof draftRecipeRequestSchema>, user: string) {
  const { prepared, item, profile } = await prepareRecipeDraft(db, applicationId, req);
  const { data, model, durationMs } = await callStructured(prepared.messages, recipeDraftSchema);
  const problems = validateRecipeAgainstProfile(data, profile);
  const payload = { ...data, environmentId: item.run.environmentId, sourceRunItemId: item.id, problems };
  return db.aiProposal.create({
    data: {
      applicationId,
      kind: "RECIPE",
      model,
      durationMs,
      requestedBy: user,
      cycleId: item.run.cycleId,
      submittedContext: prepared.submitted as Prisma.InputJsonValue,
      output: data as unknown as Prisma.InputJsonValue,
      items: { create: [{ index: 0, originalPayload: payload as Prisma.InputJsonValue, payload: payload as Prisma.InputJsonValue }] },
    },
    include: { items: true },
  });
}

export const acceptRecipeSchema = recipeDraftSchema.extend({ note: z.string().trim().max(2000).nullish() });

/** Accepting is the only way a Recipe comes to exist. The reviewer's edited version is what gets stored. */
export async function acceptRecipe(db: Db, applicationId: string, itemId: string, input: z.infer<typeof acceptRecipeSchema>, user: string) {
  const item = await pendingItem(db, applicationId, itemId);
  if (item.proposal.kind !== "RECIPE") throw badRequest("Not a recipe proposal.");
  const original = item.originalPayload as { environmentId?: string | null; sourceRunItemId?: string };
  const environmentId = original.environmentId ?? null;
  if (environmentId) {
    const env = await db.environment.findUnique({ where: { id: environmentId } });
    const profile = parseProfile(env?.agentProfile);
    if (!profile) throw badRequest("The environment this recipe was drafted for is no longer set up for the AI runner.");
    const problems = validateRecipeAgainstProfile(input, profile);
    if (problems.length) throw badRequest(`This recipe cannot be accepted: ${problems.join(" ")}`);
  }
  const { note, ...draft } = input;
  return db.$transaction(async (tx) => {
    const recipe = await tx.recipe.create({
      data: {
        applicationId,
        environmentId,
        name: draft.name,
        description: draft.explanation,
        matchRule: draft.matchRule as Prisma.InputJsonValue,
        scope: draft.scope,
        priority: draft.priority,
        steps: draft.steps as Prisma.InputJsonValue,
        successChecks: draft.successChecks as Prisma.InputJsonValue,
        aiProposalItemId: item.id,
        createdBy: user,
      },
    });
    await tx.aiProposalItem.update({
      where: { id: item.id },
      data: { status: "ACCEPTED", payload: { ...draft, environmentId, sourceRunItemId: original.sourceRunItemId } as Prisma.InputJsonValue, decidedBy: user, decidedAt: new Date(), decisionNote: note || null },
    });
    return recipe;
  });
}

export async function listRecipes(db: Db, applicationId: string) {
  return db.recipe.findMany({ where: { applicationId }, orderBy: { createdAt: "desc" } });
}

export async function disableRecipe(db: Db, applicationId: string, recipeId: string, user: string) {
  const r = await db.recipe.findUnique({ where: { id: recipeId } });
  if (!r || r.applicationId !== applicationId) throw notFound("Recipe not found.");
  if (r.status === "DISABLED") throw conflict("This recipe is already disabled.");
  return db.recipe.update({ where: { id: r.id }, data: { status: "DISABLED", disabledBy: user, disabledAt: new Date() } });
}
