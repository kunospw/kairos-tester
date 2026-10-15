// Re-queue specific cases of an AI run (same as "Let the AI retry" on the run screen).
// Usage: npx tsx --conditions=react-server --env-file=.env scripts/retry-run-items.ts <runId> <actor> <ID> [ID...]
import { createPrismaClient } from "@/server/db";
import { answerRequest } from "@/server/services/run-service";

const [runId, actor, ...ids] = process.argv.slice(2);
const db = createPrismaClient();

async function main() {
const run = await db.testRun.findUniqueOrThrow({ where: { id: runId }, include: { cycle: true } });
for (const id of ids) {
  const item = await db.runItem.findFirst({
    where: { runId, cycleCase: { testCase: { externalId: id } } },
    include: { requests: { where: { status: "OPEN", kind: { in: ["CONFIRM_RESULT", "RUN_ERROR"] } } } },
  });
  const req = item?.requests[0];
  if (!item || !req) {
    console.log(`${id}: nothing to retry`);
    continue;
  }
  await answerRequest(db, run.cycle.applicationId, req.id, { action: "retry" }, actor);
  console.log(`${id}: re-queued`);
}
await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
