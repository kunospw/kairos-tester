// Labeled simulated runs for demonstrating the automation flow.
// Only allowed in SIMULATION cycles. Every attempt and evidence row is marked
// isSimulated and these cycles are excluded from overview metrics and reports.
// No browser, script or target application is touched.

import type { Db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import { getEvidenceStorage, sha256, type EvidenceStorage } from "@/server/storage/evidence-storage";
import { isoDateToDbDate, todayIso } from "@/lib/dates";

export async function runSimulated(db: Db, cycleCaseId: string, user: string, storage: EvidenceStorage = getEvidenceStorage()) {
  const cc = await db.cycleCase.findUnique({
    where: { id: cycleCaseId },
    include: { cycle: true, caseVersion: true, testCase: true },
  });
  if (!cc) throw notFound("Cycle case not found.");
  if (cc.cycle.kind !== "SIMULATION") {
    throw badRequest("Simulated runs are only allowed in a simulation demo cycle. Real cycles never receive simulated results.");
  }
  const open = await db.executionAttempt.findFirst({ where: { cycleCaseId, status: { not: "COMPLETED" } } });
  if (open) throw conflict("Finish the open attempt first.");

  const hybrid = cc.caseVersion.executionMode === "HYBRID";
  const steps = (cc.caseVersion.steps as { text: string; required: boolean }[] | null) ?? [];
  const log = [
    "SIMULATED RUN - NOT A REAL TEST RESULT",
    `Case: ${cc.testCase.externalId} v${cc.caseVersion.versionNumber} - ${cc.caseVersion.title}`,
    `Cycle: ${cc.cycle.name} (simulation)`,
    `Generated: ${new Date().toISOString()} by ${user}`,
    "No browser, script or target application was contacted.",
    ...steps.map((s, i) => `step ${i + 1}: simulated OK - ${s.text.split("\n")[0]}`),
  ].join("\n");
  const bytes = Buffer.from(log, "utf-8");
  const key = await storage.save(bytes, "txt");

  return db.$transaction(async (tx) => {
    const last = await tx.executionAttempt.findFirst({
      where: { cycleCaseId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    return tx.executionAttempt.create({
      data: {
        cycleCaseId,
        caseVersionId: cc.caseVersionId,
        attemptNumber: (last?.attemptNumber ?? 0) + 1,
        // Hybrid cases stop at the human checkpoint: automated steps alone never pass them.
        status: hybrid ? "AWAITING_REVIEW" : "COMPLETED",
        outcome: hybrid ? null : "PASS",
        remarks: hybrid
          ? "Simulated automated steps finished. Awaiting human checkpoint before completion."
          : "Simulated run (demo only).",
        tester: `${user} (simulation)`,
        executionMethod: "SIMULATED",
        source: "SIMULATION",
        isSimulated: true,
        buildLabel: cc.cycle.buildLabel,
        startedAt: new Date(),
        completedAt: hybrid ? null : new Date(),
        executedOn: hybrid ? null : isoDateToDbDate(todayIso()),
        stepOutcomes: {
          create: steps.map((s, i) => ({
            stepIndex: i,
            stepText: s.text,
            required: s.required !== false,
            result: "PASS" as const,
            note: "Simulated",
          })),
        },
        evidence: {
          create: {
            storageKey: key,
            originalName: "simulated-run-log.txt",
            mimeType: "text/plain",
            sizeBytes: bytes.length,
            sha256: sha256(bytes),
            caption: "Simulated log (not real evidence)",
            isSimulated: true,
            uploadedBy: user,
          },
        },
      },
    });
  });
}
