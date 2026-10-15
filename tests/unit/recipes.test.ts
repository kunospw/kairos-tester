import { describe, expect, it } from "vitest";
import { pickRecipe, recipeDraftSchema, matchRuleSchema, type StoredRecipe } from "@/lib/recipes";

const click = { type: "click", role: "button", name: "Add file" };
const check = { type: "check", kind: "text_visible", text: "Upload complete", description: "upload finished" };

function stored(over: Partial<StoredRecipe> & { id: string }): StoredRecipe {
  return { name: over.id, scope: "ALL", priority: 0, environmentId: null, matchRule: { titlePattern: "upload" }, steps: [click], successChecks: [check], ...over };
}
const upload = { externalId: "UL-01", title: "Upload a CSV", section: "Upload", purpose: "SETUP" as const };

describe("recipe schema", () => {
  const base = { name: "Upload file", explanation: "x", matchRule: { titlePattern: "upload" }, steps: [click], successChecks: [check] };
  it("accepts a plain browser recipe", () => expect(recipeDraftSchema.safeParse(base).success).toBe(true));
  it("rejects verdict and question actions in steps", () => {
    expect(recipeDraftSchema.safeParse({ ...base, steps: [{ type: "finish", verdict: "PASS", summary: "ok", confidence: 1 }] }).success).toBe(false);
    expect(recipeDraftSchema.safeParse({ ...base, steps: [{ type: "ask_human", question: "what now?" }] }).success).toBe(false);
  });
  it("requires a real check", () => {
    expect(recipeDraftSchema.safeParse({ ...base, successChecks: [] }).success).toBe(false);
    expect(recipeDraftSchema.safeParse({ ...base, successChecks: [click] }).success).toBe(false);
  });
  it("rejects empty or invalid match rules", () => {
    expect(matchRuleSchema.safeParse({}).success).toBe(false);
    expect(matchRuleSchema.safeParse({ titlePattern: "(" }).success).toBe(false);
  });
});

describe("pickRecipe", () => {
  it("matches by pattern, case-insensitively", () => expect(pickRecipe([stored({ id: "a" })], upload, "env")?.id).toBe("a"));
  it("ignores recipes whose scope, environment or pattern do not fit", () => {
    expect(pickRecipe([stored({ id: "a", scope: "TEST" })], upload, "env")).toBeNull();
    expect(pickRecipe([stored({ id: "a", environmentId: "other" })], upload, "env")).toBeNull();
    expect(pickRecipe([stored({ id: "a", matchRule: { titlePattern: "^delete" } })], upload, "env")).toBeNull();
  });
  it("prefers priority, then the more specific rule", () => {
    const broad = stored({ id: "broad" });
    const specific = stored({ id: "specific", matchRule: { titlePattern: "upload", sectionPattern: "^upload$" } });
    expect(pickRecipe([broad, specific], upload, "env")?.id).toBe("specific");
    expect(pickRecipe([{ ...specific }, { ...broad, priority: 5 }], upload, "env")?.id).toBe("broad");
  });
  it("skips stored recipes whose JSON no longer validates", () => {
    expect(pickRecipe([stored({ id: "bad", steps: [{ type: "finish" }] })], upload, "env")).toBeNull();
  });
});
