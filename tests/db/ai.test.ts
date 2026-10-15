// Tests our handling of AI responses using a stubbed provider. This verifies
// review-before-mutation and validation logic only; it does NOT verify the real
// Ollama Cloud provider (use Settings → Test connection with a real key).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, importRows, sampleRows } from "./helpers";
import {
  generateDraftCases,
  generateReview,
  acceptDraftCase,
  acceptFinding,
  rejectItem,
  generateReportSummary,
  acceptReportSummary,
} from "@/server/services/ai-service";
import { createReport } from "@/server/services/report-service";
import { AiError } from "@/server/ai/ollama";

const db = testDb();
afterAll(() => db.$disconnect());

function stubProvider(content: unknown, status = 200) {
  const body = JSON.stringify(status === 200 ? { model: "stub-model", message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, done: true } : { error: "nope" });
  const fetchMock = vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let appId: string;
let cycleId: string;
beforeEach(async () => {
  await resetDb(db);
  process.env.OLLAMA_API_KEY = "test-key-not-real";
  appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  cycleId = (await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" })).cycleId;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OLLAMA_API_KEY;
});

const draft = {
  cases: [
    {
      title: "Expired code is refused",
      section: "1. Sign-in & access",
      role: "Any invited user",
      preconditions: "Real inbox",
      steps: [{ text: "Request a code", required: true }, "Wait 11 minutes and submit it"],
      testData: "",
      expectedChecks: ["Clear refusal message"],
      priority: "High",
      proposedExecutionMode: "hybrid",
      sourceReferences: ["REQ", "DOC-99"],
      assumptions: ["Expiry is 10 minutes"],
      openQuestions: [],
    },
  ],
};

describe("AI drafting requires review before mutation", () => {
  it("stores proposals only, and creates a case only on explicit accept", async () => {
    const fetchMock = stubProvider(draft);
    const casesBefore = await db.testCase.count();
    const proposal = await generateDraftCases(db, appId, { requirement: "Sign-in codes expire after 10 minutes.", contextEntryIds: [], maxCases: 3 }, "t");
    expect(await db.testCase.count()).toBe(casesBefore);
    expect(proposal.items).toHaveLength(1);
    const item = proposal.items[0];
    const payload = item.payload as { sourceReferences: string[]; validationWarnings: string[]; priority: string; proposedExecutionMode: string };
    expect(payload.sourceReferences).toEqual(["REQ"]); // invented DOC-99 removed
    expect(payload.validationWarnings.join(" ")).toMatch(/DOC-99/);
    expect(payload.priority).toBe("HIGH");
    expect(payload.proposedExecutionMode).toBe("HYBRID");

    // Key is sent as a bearer token server-side; request is non-streaming.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key-not-real");
    expect(JSON.parse(String(init.body)).stream).toBe(false);

    const accepted = await acceptDraftCase(
      db,
      appId,
      item.id,
      { payload: { ...(item.payload as Record<string, never>), title: "Expired sign-in code is refused" } as never, target: { kind: "new", externalId: "SI-07" } },
      "t",
    );
    const tc = await db.testCase.findUniqueOrThrow({ where: { id: accepted.testCaseId }, include: { versions: true } });
    expect(tc.origin).toBe("AI_PROPOSAL");
    expect(tc.versions[0]).toMatchObject({ title: "Expired sign-in code is refused", source: "AI_PROPOSAL", executionMode: "HYBRID" });
    await expect(rejectItem(db, appId, item.id, null, "t")).rejects.toThrow(/already accepted/);
  });

  it("handles malformed output and missing keys without saving anything", async () => {
    stubProvider("this is not json at all");
    await expect(generateDraftCases(db, appId, { requirement: "Something to test here", contextEntryIds: [], maxCases: 3 }, "t")).rejects.toBeInstanceOf(AiError);
    stubProvider({ cases: [{ title: "no steps" }] });
    await expect(generateDraftCases(db, appId, { requirement: "Something to test here", contextEntryIds: [], maxCases: 3 }, "t")).rejects.toThrow(/expected structure/);
    stubProvider({}, 401);
    await expect(generateDraftCases(db, appId, { requirement: "Something to test here", contextEntryIds: [], maxCases: 3 }, "t")).rejects.toThrow(/rejected the API key/);
    delete process.env.OLLAMA_API_KEY;
    await expect(generateDraftCases(db, appId, { requirement: "Something to test here", contextEntryIds: [], maxCases: 3 }, "t")).rejects.toThrow(/not configured/);
    expect(await db.aiProposal.count()).toBe(0);
  });
});

describe("AI results review", () => {
  it("never changes results; accepting a finding only records a flag", async () => {
    const si02 = await db.cycleCase.findFirstOrThrow({ where: { cycleId, testCase: { externalId: "SI-02" } }, include: { attempts: true } });
    const si01 = await db.cycleCase.findFirstOrThrow({ where: { cycleId, testCase: { externalId: "SI-01" } } });
    stubProvider({
      findings: [
        { caseId: "SI-02", type: "incomplete testing", summary: "Pass recorded but reuse and expiry untested.", evidenceQuote: "the 10-minute expiry were not tested", suggestedAction: "Retest with a real inbox" },
        { caseId: "SI-01", type: "AMBIGUOUS_OR_OUTDATED", summary: "x", evidenceQuote: "a quote that is not in the text" },
        { caseId: "ZZ-99", type: "APPLICATION_FAILURE", summary: "unknown case" },
      ],
    });
    const proposal = await generateReview(db, appId, { cycleId, cycleCaseIds: [si02.id, si01.id] }, "t");
    expect(proposal.items).toHaveLength(2); // ZZ-99 discarded
    const bad = proposal.items.find((i) => (i.payload as { caseId: string }).caseId === "SI-01")!;
    expect((bad.payload as { validationWarnings: string[] }).validationWarnings.join(" ")).toMatch(/does not appear/);
    const flagsBefore = await db.finding.count();

    const good = proposal.items.find((i) => (i.payload as { caseId: string }).caseId === "SI-02")!;
    await acceptFinding(db, appId, good.id, { type: "INCOMPLETE_TESTING", summary: "Reuse/expiry not covered." }, "t");
    expect(await db.finding.count()).toBe(flagsBefore + 1);
    const attempt = await db.executionAttempt.findUniqueOrThrow({ where: { id: si02.attempts[0].id } });
    expect(attempt.outcome).toBe("PASS"); // unchanged
    expect(attempt.updatedAt.getTime()).toBe(si02.attempts[0].updatedAt.getTime());
  });
});

describe("AI report summary", () => {
  it("only reaches the report after explicit human acceptance", async () => {
    const report = await createReport(db, appId, { cycleId, title: "R" }, "t");
    stubProvider({ summary: "Two cases passed; one failed; one blocked.", highlights: [], risks: ["SI-02 partially covered"], nextSteps: [] });
    const proposal = await generateReportSummary(db, appId, report.id, "t");
    expect((await db.reportSnapshot.findUniqueOrThrow({ where: { id: report.id } })).aiSummary).toBeNull();
    await acceptReportSummary(db, appId, proposal.items[0].id, "Edited summary.", "reviewer");
    const after = await db.reportSnapshot.findUniqueOrThrow({ where: { id: report.id } });
    expect(after).toMatchObject({ aiSummary: "Edited summary.", aiSummaryReviewed: true, aiSummaryReviewedBy: "reviewer" });
  });
});
