import { describe, expect, it } from "vitest";
import { agentProfileSchema, isRequestAllowed, type AgentProfile } from "@/lib/agent-profile";
import { planCase } from "@/lib/run-planning";

function profile(over: Record<string, unknown> = {}): AgentProfile {
  return agentProfileSchema.parse({
    baseUrl: "http://localhost:3200",
    signIn: { method: "none" },
    roleSwitch: { method: "none" },
    allowedHosts: ["kfmsapi2.ksol.ai"],
    readOnly: true,
    ...over,
  });
}

const API = "https://kfmsapi2.ksol.ai/api/Jobs/CreateJourney";

describe("isRequestAllowed", () => {
  it("allows the application's own origin and inline data", () => {
    const p = profile();
    expect(isRequestAllowed(p, "http://localhost:3200/static/js/main.js", "GET")).toBe(true);
    expect(isRequestAllowed(p, "http://localhost:3200/anything", "POST")).toBe(true);
    expect(isRequestAllowed(p, "data:image/png;base64,AAAA", "GET")).toBe(true);
    expect(isRequestAllowed(p, "blob:http://localhost:3200/abc", "GET")).toBe(true);
  });

  it("blocks every other host, including look-alikes", () => {
    const p = profile();
    expect(isRequestAllowed(p, "https://example.com/", "GET")).toBe(false);
    expect(isRequestAllowed(p, "http://localhost:3200.evil.example/", "GET")).toBe(false);
    expect(isRequestAllowed(p, "https://kfmsapi2.ksol.ai.evil.example/api/x", "GET")).toBe(false);
    expect(isRequestAllowed(p, "https://evil.kfmsapi2.ksol.ai/api/x", "GET")).toBe(false);
    expect(isRequestAllowed(p, "http://localhost:3000/", "GET")).toBe(false); // another local app
  });

  it("allows only https to an allowed API host", () => {
    expect(isRequestAllowed(profile(), "http://kfmsapi2.ksol.ai/api/Jobs/GetVehiclesList/2026-10-15", "GET")).toBe(false);
  });

  it("read-only: reads pass, changes are blocked", () => {
    const p = profile();
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(isRequestAllowed(p, API, m)).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) expect(isRequestAllowed(p, API, m)).toBe(false);
  });

  it("read-only: SignalR connection set-up is allowed, other POSTs on the hub are not", () => {
    const p = profile();
    expect(isRequestAllowed(p, "https://kfmsapi2.ksol.ai/journeyHub/negotiate?negotiateVersion=1", "POST")).toBe(true);
    expect(isRequestAllowed(p, "https://kfmsapi2.ksol.ai/api/Jobs/negotiate-price", "POST")).toBe(false);
  });

  it("read-only: the sign-in request passes only while signing in", () => {
    const p = profile();
    const login = "https://kfmsapi2.ksol.ai/api/Account/login";
    expect(isRequestAllowed(p, login, "POST")).toBe(false);
    expect(isRequestAllowed(p, login, "POST", { signingIn: true })).toBe(true);
  });

  it("not read-only: allowed hosts accept changes (other hosts still blocked)", () => {
    const p = profile({ readOnly: false });
    expect(isRequestAllowed(p, API, "POST")).toBe(true);
    expect(isRequestAllowed(p, "https://example.com/", "POST")).toBe(false);
  });

  it("with no allowed hosts nothing off-origin gets through", () => {
    const p = profile({ allowedHosts: [] });
    expect(isRequestAllowed(p, API, "GET")).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(isRequestAllowed(profile(), "not a url", "GET")).toBe(false);
  });
});

describe("profile rules", () => {
  it("accepts plain host names and lower-cases them", () => {
    expect(profile({ allowedHosts: ["KFMSAPI2.ksol.ai"] }).allowedHosts).toEqual(["kfmsapi2.ksol.ai"]);
  });

  it("refuses schemes, ports, paths, wildcards and single labels as hosts", () => {
    for (const h of ["https://kfmsapi2.ksol.ai", "kfmsapi2.ksol.ai:443", "kfmsapi2.ksol.ai/api", "*.ksol.ai", "localhost", "a b.example.com"]) {
      expect(agentProfileSchema.safeParse({ baseUrl: "http://localhost:3200", signIn: { method: "none" }, roleSwitch: { method: "none" }, allowedHosts: [h] }).success, h).toBe(false);
    }
  });

  it("still only allows an application on this computer", () => {
    expect(agentProfileSchema.safeParse({ baseUrl: "https://kfms.example.com", signIn: { method: "none" }, roleSwitch: { method: "none" } }).success).toBe(false);
  });

  it("password sign-in names variables starting with KT_ only (no reading other secrets)", () => {
    const base = { baseUrl: "http://localhost:3200", roleSwitch: { method: "none" } };
    const ok = agentProfileSchema.safeParse({ ...base, signIn: { method: "password", usernameEnv: "KT_KFMS_USER", passwordEnv: "KT_KFMS_PASSWORD" } });
    expect(ok.success).toBe(true);
    for (const bad of ["OLLAMA_API_KEY", "DATABASE_URL", "TESTER_PASSWORD_HASH", "kt_lower", "KT_"]) {
      const r = agentProfileSchema.safeParse({ ...base, signIn: { method: "password", usernameEnv: "KT_KFMS_USER", passwordEnv: bad } });
      expect(r.success, bad).toBe(false);
    }
  });

  it("a password sign-in has defaults for the usual sign-in page", () => {
    const p = agentProfileSchema.parse({ baseUrl: "http://localhost:3200", roleSwitch: { method: "none" }, signIn: { method: "password", usernameEnv: "KT_A", passwordEnv: "KT_B" } });
    expect(p.signIn).toMatchObject({ loginPath: "/sign-in", usernameField: "Username", passwordField: "Password", submitButton: "Sign In" });
  });

  it("defaults are off: not read-only, no extra hosts", () => {
    const p = agentProfileSchema.parse({ baseUrl: "http://localhost:3000", signIn: { method: "none" }, roleSwitch: { method: "none" } });
    expect(p.readOnly).toBe(false);
    expect(p.allowedHosts).toEqual([]);
  });
});

describe("planCase in a read-only environment", () => {
  const ctx = { reachableEnvironments: [], disposable: false, codesWithoutInbox: false, readOnly: true };
  const c = { externalId: "CJ-02", title: "Create a basic journey", environment: null, preconditions: null, stepsText: "1. Click Create.", expectedResult: "A card shows." };

  it("skips cases marked as changing data", () => {
    expect(planCase({ ...c, testData: "Creates or changes data in the shared UAT." }, ctx)).toMatchObject({ plan: "NOT_ALLOWED" });
    expect(planCase({ ...c, testData: "Changes data in Epicor (shared UAT) and cannot be undone." }, ctx)).toMatchObject({ plan: "NOT_ALLOWED" });
  });

  it("runs cases that only look", () => {
    expect(planCase({ ...c, title: "Date navigation changes the day", testData: "" }, ctx)).toMatchObject({ plan: "AUTOMATABLE" });
    expect(planCase({ ...c, title: "Home page loads", testData: null }, ctx)).toMatchObject({ plan: "AUTOMATABLE" });
  });

  it("does not apply the rule outside read-only environments", () => {
    expect(planCase({ ...c, testData: "Creates or changes data in the shared UAT." }, { ...ctx, readOnly: false })).toMatchObject({ plan: "AUTOMATABLE" });
  });
});
