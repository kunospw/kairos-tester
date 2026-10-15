// Recipes: AI drafts only a proposal; a Recipe exists only after a reviewer accepts it.
// Provider is stubbed; this does not verify the real Ollama Cloud model.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, importRows, sampleRows } from "./helpers";
import { createCycle } from "@/server/services/cycle-service";
import { generateRecipeDraft, acceptRecipe, disableRecipe } from "@/server/services/recipe-service";
import { rejectItem } from "@/server/services/ai-service";
import { pickRecipe } from "@/lib/recipes";
import { ACTIONS_PREFIX } from "@/lib/recipes";

const db = testDb();
afterAll(() => db.$disconnect());

const profile = {
  baseUrl: "http://localhost:3000",
  signIn: { method: "none" },
  roleSwitch: { method: "none" },
  roleAccounts: { "K admin": null },
  protectedNames: ["Demo Co"],
  uploadDirs: [],
};

const draft = {
  name: "Sign in then open projects",
  explanation: "Opens the projects list.",
  scope: "SETUP",
  priority: 1,
  matchRule: { titlePattern: "sign" },
  steps: [{ type: "goto", path: "/projects" }],
  successChecks: [{ type: "check", kind: "url_contains", text: "/projects", description: "on projects" }],
};

function stub(content: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model: "stub", message: { role: "assistant", content: JSON.stringify(content) }, done: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
}

let appId: string;
let runItemId: string;
let envId: string;
beforeEach(async () => {
  await resetDb(db);
  process.env.OLLAMA_API_KEY = "test-key-not-real";
  appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
  const cycle = await createCycle(db, appId, { name: "Run", kind: "STANDARD", include: { mode: "all" } }, "t");
  envId = (await db.environment.create({ data: { applicationId: appId, name: "Demo", agentProfile: profile } })).id;
  const cc = await db.cycleCase.findFirstOrThrow({ where: { cycleId: cycle.id, testCase: { externalId: "SI-01" } } });
  const run = await db.testRun.create({ data: { cycleId: cycle.id, environmentId: envId, model: "m", startedBy: "t" } });
  runItemId = (await db.runItem.create({ data: { runId: run.id, cycleCaseId: cc.id, sortOrder: 0, plan: "AUTOMATABLE", status: "SKIPPED" } })).id;
  await db.runEvent.create({ data: { runId: run.id, runItemId, message: `${ACTIONS_PREFIX}SI-01\n#0 goto -> ok` } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OLLAMA_API_KEY;
});

describe("recipes", () => {
  it("drafting creates a pending proposal and no recipe", async () => {
    stub(draft);
    const p = await generateRecipeDraft(db, appId, { runItemId }, "dyah");
    expect(p.kind).toBe("RECIPE");
    expect(p.items[0].status).toBe("PENDING");
    expect(await db.recipe.count()).toBe(0);
  });

  it("malformed or unsafe drafts are not saved", async () => {
    stub({ ...draft, steps: [{ type: "finish", verdict: "PASS", summary: "x", confidence: 1 }] });
    await expect(generateRecipeDraft(db, appId, { runItemId }, "dyah")).rejects.toThrow();
    expect(await db.aiProposal.count()).toBe(0);
  });

  it("accepting activates the reviewer's edited version, and it then matches", async () => {
    stub(draft);
    const p = await generateRecipeDraft(db, appId, { runItemId }, "dyah");
    const r = await acceptRecipe(db, appId, p.items[0].id, { ...draft, name: "Edited name" } as never, "dyah");
    expect(r).toMatchObject({ name: "Edited name", status: "ACTIVE", environmentId: envId });
    const found = pickRecipe(await db.recipe.findMany({ where: { status: "ACTIVE" } }), { externalId: "SI-01", title: "Sign in", section: null, purpose: "SETUP" }, envId);
    expect(found?.name).toBe("Edited name");
    await expect(acceptRecipe(db, appId, p.items[0].id, draft as never, "dyah")).rejects.toThrow(/already/);
  });

  it("refuses to accept steps the runner would refuse", async () => {
    stub(draft);
    const p = await generateRecipeDraft(db, appId, { runItemId }, "dyah");
    await expect(acceptRecipe(db, appId, p.items[0].id, { ...draft, steps: [{ type: "goto", path: "http://evil.example/x" }] } as never, "dyah")).rejects.toThrow(/cannot be accepted/);
    await expect(acceptRecipe(db, appId, p.items[0].id, { ...draft, steps: [{ type: "upload", file: "secrets.csv" }] } as never, "dyah")).rejects.toThrow(/cannot be accepted/);
    expect(await db.recipe.count()).toBe(0);
  });

  it("rejected drafts never become recipes; disabled recipes stop matching", async () => {
    stub(draft);
    const p = await generateRecipeDraft(db, appId, { runItemId }, "dyah");
    await rejectItem(db, appId, p.items[0].id, "no", "dyah");
    expect(await db.recipe.count()).toBe(0);
    const p2 = await generateRecipeDraft(db, appId, { runItemId }, "dyah");
    const r = await acceptRecipe(db, appId, p2.items[0].id, draft as never, "dyah");
    await disableRecipe(db, appId, r.id, "dyah");
    expect(await db.recipe.count({ where: { status: "ACTIVE" } })).toBe(0);
  });
});
