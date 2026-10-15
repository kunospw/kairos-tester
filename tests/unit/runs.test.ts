import { describe, it, expect } from "vitest";
import { planCase, dependenciesOf } from "@/lib/run-planning";
import { decide, agentReplySchema } from "@/lib/agent-protocol";
import { agentProfileSchema, isAllowedUrl, accountForRole } from "@/lib/agent-profile";

const ctx = { reachableEnvironments: ["Demo"], disposable: false, codesWithoutInbox: true };
const c = (over: Partial<Parameters<typeof planCase>[0]>) => ({
  externalId: "X-01",
  title: "T",
  environment: "Demo",
  preconditions: null,
  stepsText: "1. Open the page.",
  expectedResult: "It shows.",
  ...over,
});

describe("run planning", () => {
  it("sends unreachable environments and human-only steps to a person", () => {
    expect(planCase(c({ environment: "Cloud2" }), ctx).plan).toBe("NEEDS_HUMAN");
    expect(planCase(c({ stepsText: "1. Request a new code, wait 11 minutes, then try it." }), ctx).reason).toMatch(/real-time wait/);
    expect(planCase(c({ preconditions: "An invited account with a real inbox." }), ctx).plan).toBe("NEEDS_HUMAN");
    expect(planCase(c({ stepsText: "2. Wait up to an hour, or run the purge." }), ctx).plan).toBe("NEEDS_HUMAN");
    expect(planCase(c({ stepsText: "1. Check the bar colour by eye." }), ctx).plan).toBe("NEEDS_HUMAN");
    expect(planCase(c({ stepsText: "1. With FT_EPICOR_CONNECTOR=mock, open Settings.\n2. Restart with FT_EPICOR_CONNECTOR=toolkit." }), ctx).reason).toMatch(/restarted/);
  });

  it("treats 'code from the email' as automatable only when codes can be read locally", () => {
    const s = c({ stepsText: "1. Enter the code from the email and click Sign in." });
    expect(planCase(s, ctx).plan).toBe("AUTOMATABLE");
    expect(planCase(s, { ...ctx, codesWithoutInbox: false }).plan).toBe("NEEDS_HUMAN");
  });

  it("does not run data-changing cases unless the environment is disposable", () => {
    const d = c({ stepsText: "1. Click Delete and confirm." });
    expect(planCase(d, ctx).plan).toBe("NOT_ALLOWED");
    expect(planCase(d, { ...ctx, disposable: true }).plan).toBe("AUTOMATABLE");
  });

  it("reads dependencies from preconditions", () => {
    expect(dependenciesOf("LD-03 done. Also see LD-01, LD-03.", "LD-04")).toEqual(["LD-03", "LD-01"]);
    expect(dependenciesOf(null, "X")).toEqual([]);
  });
});

describe("verdict policy (passes auto, everything else confirmed)", () => {
  const base = {
    verdict: "PASS" as const,
    confidence: 0.9,
    checks: [{ description: "msg shown", kind: "text_visible", passed: true, detail: "found" }],
    steps: [{ stepIndex: 0, result: "PASS" as const, note: "" }],
    requiredSteps: [0],
    screenshots: 1,
  };
  it("auto-records a pass only when it is fully backed", () => {
    expect(decide(base).kind).toBe("AUTO_PASS");
    expect(decide({ ...base, checks: [] })).toMatchObject({ kind: "CONFIRM", proposed: "PASS" });
    expect(decide({ ...base, checks: [{ ...base.checks[0], passed: false }] })).toMatchObject({ kind: "CONFIRM", proposed: "FAIL" });
    expect(decide({ ...base, steps: [] })).toMatchObject({ kind: "CONFIRM" });
    expect(decide({ ...base, confidence: 0.4 })).toMatchObject({ kind: "CONFIRM" });
    expect(decide({ ...base, screenshots: 0 })).toMatchObject({ kind: "CONFIRM" });
  });
  it("never records a fail or block without a person", () => {
    expect(decide({ ...base, verdict: "FAIL" })).toMatchObject({ kind: "CONFIRM", proposed: "FAIL" });
    expect(decide({ ...base, verdict: "BLOCKED" })).toMatchObject({ kind: "CONFIRM", proposed: "BLOCKED" });
  });
});

describe("agent profile and protocol", () => {
  const profile = agentProfileSchema.parse({
    baseUrl: "http://localhost:3000",
    signIn: { method: "none" },
    roleSwitch: { method: "none" },
    roleAccounts: { "K admin": null, "Data owner": "demo.arlead" },
  });
  it("only allows localhost applications and same-origin navigation", () => {
    expect(agentProfileSchema.safeParse({ ...profile, baseUrl: "https://kft.example.com" }).success).toBe(false);
    expect(isAllowedUrl(profile, "/admin")).toBe(true);
    expect(isAllowedUrl(profile, "http://localhost:3000/x")).toBe(true);
    expect(isAllowedUrl(profile, "https://evil.example.com/")).toBe(false);
    expect(isAllowedUrl(profile, "http://localhost:3100/")).toBe(false);
  });
  it("maps roles case-insensitively", () => {
    expect(accountForRole(profile, "data owner")).toEqual({ known: true, account: "demo.arlead" });
    expect(accountForRole(profile, "K admin")).toEqual({ known: true, account: null });
    expect(accountForRole(profile, "Auditor").known).toBe(false);
  });
  it("validates model replies", () => {
    expect(agentReplySchema.safeParse({ thought: "x", action: { type: "click", role: "button", name: "Save" } }).success).toBe(true);
    expect(agentReplySchema.safeParse({ action: { type: "shell", cmd: "rm" } }).success).toBe(false);
    expect(agentReplySchema.safeParse({ action: { type: "finish", verdict: "PASS", summary: "ok", confidence: 3 } }).success).toBe(false);
  });
});
