import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, importRows, sampleRows, tempStorage, PNG_BYTES } from "./helpers";
import { createCycle } from "@/server/services/cycle-service";
import { startOrResumeAttempt, completeAttempt } from "@/server/services/execution-service";
import { addEvidence, readEvidence } from "@/server/services/evidence-service";
import { buildReportData } from "@/server/services/report-service";
import { isValidStorageKey, LocalEvidenceStorage } from "@/server/storage/evidence-storage";

const db = testDb();
afterAll(() => db.$disconnect());

let attemptId: string;
let cycleId: string;
let ccId: string;
const { dir, storage } = tempStorage();

beforeEach(async () => {
  await resetDb(db);
  const appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
  cycleId = (await createCycle(db, appId, { name: "Run", kind: "STANDARD", include: { mode: "all" } }, "t")).id;
  ccId = (await db.cycleCase.findFirstOrThrow({ where: { cycleId, testCase: { externalId: "SI-03" } } })).id;
  attemptId = (await startOrResumeAttempt(db, ccId, "t")).attempt.id;
});

describe("evidence", () => {
  it("stores files outside public/ with generated names and reads them back", async () => {
    const ev = await addEvidence(db, attemptId, { name: "..\\..\\screen shot.png", bytes: PNG_BYTES }, "login page", "t", storage);
    expect(ev.mimeType).toBe("image/png");
    expect(ev.originalName).toBe("screen shot.png");
    expect(isValidStorageKey(ev.storageKey)).toBe(true);
    const onDisk = path.join(dir, ev.storageKey.slice(0, 2), ev.storageKey);
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(onDisk.includes(`${path.sep}public${path.sep}`)).toBe(false);
    const { bytes } = await readEvidence(db, ev.id, storage);
    expect(bytes.equals(PNG_BYTES)).toBe(true);
  });

  it("rejects unsupported content regardless of the file extension", async () => {
    const exe = Buffer.from("MZ\x90\x00\x03\x00\x00\x00binary", "latin1");
    await expect(addEvidence(db, attemptId, { name: "photo.png", bytes: exe }, null, "t", storage)).rejects.toThrow(/Unsupported file type/);
    await expect(addEvidence(db, attemptId, { name: "page.html", bytes: Buffer.from("<script>") }, null, "t", storage)).rejects.toThrow(/Unsupported/);
  });

  it("enforces the size limit", async () => {
    const prev = process.env.EVIDENCE_MAX_BYTES;
    process.env.EVIDENCE_MAX_BYTES = "10";
    try {
      await expect(addEvidence(db, attemptId, { name: "a.png", bytes: PNG_BYTES }, null, "t", storage)).rejects.toThrow(/larger than/);
    } finally {
      process.env.EVIDENCE_MAX_BYTES = prev;
    }
  });

  it("rejects path traversal in storage keys", async () => {
    const s = new LocalEvidenceStorage(dir);
    await expect(s.read("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(s.read("..\\secret.png")).rejects.toThrow(/Invalid storage key/);
  });

  it("persists evidence across retests and links it in reports", async () => {
    const ev = await addEvidence(db, attemptId, { name: "fail.png", bytes: PNG_BYTES }, null, "t", storage);
    await completeAttempt(db, attemptId, { outcome: "FAIL", outcomeReason: "Wrong message", tester: "t" }, "t");
    await expect(addEvidence(db, attemptId, { name: "late.png", bytes: PNG_BYTES }, null, "t", storage)).rejects.toThrow(/only be added while an attempt is open/);

    const { attempt: retest } = await startOrResumeAttempt(db, ccId, "t");
    expect(retest.attemptNumber).toBe(2);
    expect(await db.evidence.count({ where: { attemptId } })).toBe(1);

    // Report (latest completed = attempt 1 for now) includes the evidence link.
    const report = await buildReportData(db, cycleId);
    const row = report.cases.find((c) => c.externalId === "SI-03")!;
    expect(row.evidence.map((e) => e.id)).toEqual([ev.id]);
  });
});
