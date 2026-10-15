// Re-queue setup items of a run that were skipped (e.g. after a runner fix), discarding their undecided attempts.
// Usage: npx tsx --conditions=react-server --env-file=.env scripts/requeue-setup.ts <runId>
import { createPrismaClient } from "@/server/db";
import { discardUndecidedAgentAttempt } from "@/server/services/run-service";

async function main() {
  const runId = process.argv[2];
  const db = createPrismaClient();
  const items = await db.runItem.findMany({
    where: { runId, purpose: "SETUP", status: { in: ["SKIPPED", "RUNNING"] } },
    include: { cycleCase: { include: { testCase: true, attempts: { where: { status: { not: "COMPLETED" } } } } } },
  });
  for (const it of items) {
    for (const a of it.cycleCase.attempts) await discardUndecidedAgentAttempt(db, a.id);
    await db.runItem.update({ where: { id: it.id }, data: { status: "QUEUED", attemptId: null, currentStep: null, statusNote: "Re-queued after a runner fix." } });
    console.log(`${it.cycleCase.testCase.externalId}: re-queued`);
  }
  await db.testRun.update({ where: { id: runId }, data: { status: "RUNNING", finishedAt: null } });
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
