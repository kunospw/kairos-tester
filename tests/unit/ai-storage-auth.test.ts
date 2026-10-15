import { describe, it, expect } from "vitest";
import { draftCasesOutputSchema, validateDraftedCases, validateFindings, reviewOutputSchema, buildDraftCasesMessages } from "@/lib/ai/schemas";
import { extractJson, AiError } from "@/server/ai/ollama";
import { detectEvidenceType, isValidStorageKey, safeDisplayName } from "@/server/storage/evidence-storage";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { contextFromSheet, guessCategory } from "@/lib/import/context-sheet";
import type { SheetTable } from "@/lib/import/parse";

describe("AI output validation", () => {
  it("coerces loose enum spellings and string steps", () => {
    const parsed = draftCasesOutputSchema.parse({
      cases: [{ title: "T", steps: ["Do it"], expectedChecks: ["Works"], priority: "med", proposedExecutionMode: "manual" }],
    });
    expect(parsed.cases[0]).toMatchObject({ priority: "MEDIUM", proposedExecutionMode: "MANUAL", steps: [{ text: "Do it", required: true }] });
  });

  it("rejects cases with no steps or expected checks", () => {
    expect(draftCasesOutputSchema.safeParse({ cases: [{ title: "T", steps: [], expectedChecks: [], priority: "HIGH", proposedExecutionMode: "MANUAL" }] }).success).toBe(false);
  });

  it("removes invented source references", () => {
    const [c] = validateDraftedCases(
      draftCasesOutputSchema.parse({
        cases: [{ title: "T", steps: ["a"], expectedChecks: ["b"], priority: "HIGH", proposedExecutionMode: "MANUAL", sourceReferences: ["[CTX-1]", "CTX-7"] }],
      }).cases,
      ["REQ", "CTX-1"],
    );
    expect(c.sourceReferences).toEqual(["CTX-1"]);
    expect(c.validationWarnings[0]).toMatch(/CTX-7/);
  });

  it("drops findings for unsubmitted cases and checks quotes", () => {
    const findings = reviewOutputSchema.parse({
      findings: [
        { caseId: "si-02", type: "INCOMPLETE_TESTING", summary: "s", evidenceQuote: "expiry were  NOT tested" },
        { caseId: "XX-1", type: "BLOCKED_OR_SETUP", summary: "s" },
      ],
    }).findings;
    const res = validateFindings(findings, new Map([["SI-02", "Notes: the 10-minute expiry were not tested"]]));
    expect(res.droppedCaseIds).toEqual(["XX-1"]);
    expect(res.findings[0].caseId).toBe("SI-02");
    expect(res.findings[0].validationWarnings).toEqual([]);
  });

  it("extracts JSON from fenced or think-prefixed output and reports malformed output", () => {
    expect(extractJson('<think>hmm</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(() => extractJson("no json")).toThrow(AiError);
  });

  it("labels unreviewed context and restricts reference keys in the prompt", () => {
    const [, user] = buildDraftCasesMessages({
      applicationName: "App",
      requirement: "Req text",
      context: [{ ref: "CTX-1", title: "Rule", category: "Business rules", status: "UNREVIEWED", body: "Body" }],
      maxCases: 2,
    });
    expect(user.content).toContain("[CTX-1] (Business rules; UNREVIEWED)");
    expect(user.content).toContain("Allowed source reference keys: REQ, CTX-1");
  });
});

describe("evidence type detection", () => {
  it("detects by content and only accepts text for text extensions", () => {
    expect(detectEvidenceType(Buffer.from("%PDF-1.7 ..."), "x.bin")?.mime).toBe("application/pdf");
    expect(detectEvidenceType(Buffer.from("log line\n"), "run.log")?.ext).toBe("log");
    expect(detectEvidenceType(Buffer.from("<html>"), "a.html")).toBeNull();
    expect(detectEvidenceType(Buffer.from([0x00, 0x01]), "a.txt")).toBeNull();
    expect(detectEvidenceType(Buffer.from([0xc3, 0x28]), "a.txt")).toBeNull(); // invalid UTF-8
  });

  it("validates storage keys and sanitises display names", () => {
    expect(isValidStorageKey("123e4567-e89b-12d3-a456-426614174000.png")).toBe(true);
    expect(isValidStorageKey("../123e4567-e89b-12d3-a456-426614174000.png")).toBe(false);
    expect(isValidStorageKey("123e4567-e89b-12d3-a456-426614174000.exe")).toBe(false);
    expect(safeDisplayName("C:\\Users\\x\\..\\shot<1>.png")).toBe("shot_1_.png");
  });
});

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt:")).toBe(true);
    expect(h).not.toContain("$");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong password!!", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("guidance sheet to context", () => {
  it("splits headed blocks into unreviewed candidates with source rows", () => {
    const table: SheetTable = {
      name: "How to use",
      headerRowNumber: 1,
      headers: ["Checklist title"],
      rows: [
        { rowNumber: 2, cells: ["Intro text."] },
        { rowNumber: 4, cells: ["Known gaps (not failures)"] },
        { rowNumber: 5, cells: ["• MFA isn't built yet."] },
        { rowNumber: 7, cells: ["Test accounts (Demo Co)"] },
        { rowNumber: 8, cells: ["k.admin", "Kerry Admin", "K admin"] },
      ],
    };
    const c = contextFromSheet(table);
    expect(c.map((x) => x.title)).toEqual(["Checklist title", "Known gaps (not failures)", "Test accounts (Demo Co)"]);
    expect(c[1]).toMatchObject({ category: "CONSTRAINTS_GAPS", sourceRows: "rows 4-5" });
    expect(c[2].body).toBe("k.admin | Kerry Admin | K admin");
    expect(guessCategory("Test accounts")).toBe("ROLES_PERMISSIONS");
  });
});
