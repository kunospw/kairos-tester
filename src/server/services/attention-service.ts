// Everything that is waiting for a person, in one place. The "Needs you" inbox,
// the badge in the app navigation and the runner indicator all read from here,
// so a decision made anywhere disappears everywhere.
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

/** The runner beats every 5 s; after this long without a beat it counts as stopped. */
export const RUNNER_STALE_MS = 20_000;

export async function runnerStatus(db: Db) {
  const r = await db.runnerStatus.findUnique({ where: { id: "local" }, select: { lastSeenAt: true, info: true } });
  return {
    online: Boolean(r && Date.now() - r.lastSeenAt.getTime() < RUNNER_STALE_MS),
    lastSeenAt: r?.lastSeenAt.toISOString() ?? null,
    info: r?.info ?? null,
  };
}

/**
 * Open questions from AI runs. CONFIRM_RESULT requests are left out: their attempt
 * is listed under results to confirm, and deciding it closes the request.
 */
function openRequestsWhere(applicationId: string): Prisma.HumanRequestWhereInput {
  return { status: "OPEN", kind: { not: "CONFIRM_RESULT" }, runItem: { run: { cycle: { applicationId } } } };
}

/**
 * Results waiting for a decision. Left out: setup re-runs (plumbing, never a result
 * anyone asked for) and attempts whose case already has an open "could not finish"
 * request, which is shown as that request instead.
 */
function reviewsWhere(applicationId: string): Prisma.ExecutionAttemptWhereInput {
  return {
    status: "AWAITING_REVIEW",
    cycleCase: { cycle: { applicationId, status: "OPEN" } },
    runItems: { none: { OR: [{ purpose: "SETUP" }, { requests: { some: { status: "OPEN", kind: "RUN_ERROR" } } }] } },
  };
}

function pendingProposalsWhere(applicationId: string): Prisma.AiProposalItemWhereInput {
  return { status: "PENDING", proposal: { applicationId } };
}

export async function attentionCounts(db: Db, applicationId: string) {
  const [questions, reviews, proposals, runner] = await Promise.all([
    db.humanRequest.count({ where: openRequestsWhere(applicationId) }),
    db.executionAttempt.count({ where: reviewsWhere(applicationId) }),
    db.aiProposalItem.count({ where: pendingProposalsWhere(applicationId) }),
    runnerStatus(db),
  ]);
  // AI suggestions are optional reading, so they are shown but not counted as "needs you".
  return { needsYou: questions + reviews, questions, reviews, proposals, runner };
}

export async function inbox(db: Db, applicationId: string) {
  const [requests, reviews, proposals] = await Promise.all([
    db.humanRequest.findMany({
      where: openRequestsWhere(applicationId),
      orderBy: { createdAt: "asc" },
      include: { runItem: { include: { run: { include: { cycle: true } }, cycleCase: { include: { caseVersion: true } } } } },
    }),
    db.executionAttempt.findMany({
      where: reviewsWhere(applicationId),
      orderBy: { createdAt: "asc" },
      include: {
        caseVersion: true,
        stepOutcomes: { orderBy: { stepIndex: "asc" } },
        evidence: { orderBy: { createdAt: "asc" } },
        cycleCase: { include: { testCase: true, cycle: true } },
        runItems: { select: { requests: { where: { status: "OPEN", kind: "CONFIRM_RESULT" }, select: { id: true } } } },
      },
    }),
    db.aiProposal.findMany({
      where: { applicationId, items: { some: { status: "PENDING" } } },
      orderBy: { createdAt: "desc" },
      include: { items: { where: { status: "PENDING" }, select: { id: true } } },
    }),
  ]);
  return { requests, reviews, proposals };
}
