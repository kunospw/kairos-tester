// Cases that depend on other cases in the same run ("SI-01 done" in their
// preconditions) wait instead of being skipped. They start by themselves once the
// cases they depend on pass, and come to a person only if one of those definitely
// didn't pass.
import type { Db } from "@/server/db";
import { dependenciesOf } from "@/lib/run-planning";

/** A person said "run it anyway / check it again": dependencies no longer hold it back. */
export const RECHECK_PREFIX = "recheck";

export interface DependencyState {
  /** Prerequisites still in progress (queued, running, waiting on a person...). */
  pending: string[];
  /** Prerequisites that ended without passing (failed, blocked, skipped). */
  notPassed: string[];
}

export async function dependencyState(db: Db, runId: string, preconditions: string | null, externalId: string): Promise<DependencyState> {
  const deps = dependenciesOf(preconditions, externalId);
  const state: DependencyState = { pending: [], notPassed: [] };
  if (!deps.length) return state;
  const others = await db.runItem.findMany({
    where: { runId, cycleCase: { testCase: { externalId: { in: deps } } } },
    include: { cycleCase: { include: { testCase: true } }, attempt: true },
  });
  for (const o of others) {
    const id = o.cycleCase.testCase.externalId;
    const decided = o.attempt?.status === "COMPLETED";
    if (decided && o.attempt!.outcome === "PASS") continue;
    if ((decided && o.status === "DONE") || o.status === "SKIPPED") state.notPassed.push(id);
    else state.pending.push(id);
  }
  return state;
}

export async function personAskedToRecheck(db: Db, runItemId: string) {
  return (await db.humanRequest.count({ where: { runItemId, status: "ANSWERED", answer: { startsWith: RECHECK_PREFIX } } })) > 0;
}

/**
 * Re-evaluate every waiting case in a run: start the ones whose prerequisites passed,
 * and ask a person about the ones whose prerequisites can no longer pass by themselves.
 */
export async function releaseWaiting(db: Db, runId: string) {
  const waiting = await db.runItem.findMany({
    where: { runId, status: "WAITING" },
    include: { cycleCase: { include: { testCase: true, caseVersion: true } } },
  });
  for (const it of waiting) {
    const ext = it.cycleCase.testCase.externalId;
    const st = await dependencyState(db, runId, it.cycleCase.caseVersion.preconditions, ext);
    if (!st.pending.length && !st.notPassed.length) {
      await db.runItem.update({ where: { id: it.id }, data: { status: "QUEUED", statusNote: "Its prerequisites passed; the AI will run it now." } });
      await db.testRun.update({ where: { id: runId }, data: { status: "RUNNING", finishedAt: null } });
      await db.runEvent.create({ data: { runId, runItemId: it.id, message: `${ext}: prerequisites passed, back in the queue.` } });
    } else if (!st.pending.length) {
      const deps = st.notPassed.join(", ");
      await db.runItem.update({ where: { id: it.id }, data: { status: "NEEDS_HUMAN", statusNote: `Waits for ${deps}, which did not pass.` } });
      if (!(await db.humanRequest.count({ where: { runItemId: it.id, status: "OPEN" } }))) {
        await db.humanRequest.create({
          data: {
            runItemId: it.id,
            kind: "MANUAL_CASE",
            question: `${ext} waits for ${deps}, which did not pass.`,
            detail: `Fix and re-check ${deps} first, or let the AI run ${ext} anyway.`,
          },
        });
      }
      await db.runEvent.create({ data: { runId, runItemId: it.id, message: `${ext}: needs you (${deps} did not pass).` } });
    }
  }
}
