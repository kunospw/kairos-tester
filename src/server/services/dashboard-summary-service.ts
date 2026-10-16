// Read-only summary for an external dashboard (kapphelper's team dashboard) to poll.
// Deliberately narrow and read-only: no mutation, no auth beyond the existing
// agent-token seam in @/server/http. Nothing here is cached — these are cheap,
// small-scale queries (a handful of apps/cycles), not a hot path.
import type { Db } from "@/server/db";
import { notFound } from "@/server/errors";

export interface DashboardSummary {
  applicationId: string;
  applicationName: string;
  /** null when nothing is currently RUNNING — a dashboard card shows "idle", not a stale run. */
  activeRun: {
    id: string;
    status: "RUNNING" | "COMPLETED" | "CANCELLED";
    startedAt: string;
    progress: { queued: number; running: number; needsHuman: number; done: number; skipped: number; error: number };
  } | null;
  /** Latest completed outcome per case in the latest OPEN, non-simulation cycle. */
  counts: { pass: number; fail: number; blocked: number; notRun: number };
  findingsOpenCount: number;
  latestReportSnapshot: {
    id: string;
    title: string;
    status: "DRAFT" | "FINAL";
    createdAt: string;
    aiSummary: string | null;
  } | null;
}

async function activeRunProgress(db: Db, applicationId: string): Promise<DashboardSummary["activeRun"]> {
  const run = await db.testRun.findFirst({
    where: { cycle: { applicationId }, status: "RUNNING" },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { status: true } } },
  });
  if (!run) return null;
  const count = (status: string) => run.items.filter((i) => i.status === status).length;
  return {
    id: run.id,
    status: run.status,
    startedAt: run.createdAt.toISOString(),
    progress: {
      queued: count("QUEUED"),
      running: count("RUNNING"),
      needsHuman: count("NEEDS_HUMAN"),
      done: count("DONE"),
      skipped: count("SKIPPED"),
      error: count("ERROR"),
    },
  };
}

async function latestOpenCycleCounts(db: Db, applicationId: string): Promise<DashboardSummary["counts"]> {
  const cycle = await db.testCycle.findFirst({
    where: { applicationId, status: "OPEN", kind: { not: "SIMULATION" } },
    orderBy: { createdAt: "desc" },
  });
  const counts = { pass: 0, fail: 0, blocked: 0, notRun: 0 };
  if (!cycle) return counts;
  const cycleCases = await db.cycleCase.findMany({
    where: { cycleId: cycle.id },
    include: { attempts: { where: { status: "COMPLETED" }, orderBy: { attemptNumber: "desc" }, take: 1 } },
  });
  for (const cc of cycleCases) {
    const outcome = cc.attempts[0]?.outcome ?? "NOT_RUN";
    if (outcome === "PASS") counts.pass += 1;
    else if (outcome === "FAIL") counts.fail += 1;
    else if (outcome === "BLOCKED") counts.blocked += 1;
    else counts.notRun += 1; // NOT_RUN or NOT_APPLICABLE
  }
  return counts;
}

async function latestReportSnapshotFor(db: Db, applicationId: string): Promise<DashboardSummary["latestReportSnapshot"]> {
  const report = await db.reportSnapshot.findFirst({
    where: { cycle: { applicationId } },
    orderBy: { createdAt: "desc" },
  });
  if (!report) return null;
  return {
    id: report.id,
    title: report.title,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    aiSummary: report.aiSummary ?? null,
  };
}

export async function dashboardSummary(db: Db, applicationId: string): Promise<DashboardSummary> {
  const application = await db.application.findUnique({ where: { id: applicationId }, select: { id: true, name: true } });
  if (!application) throw notFound("Application not found.");
  const [activeRun, counts, findingsOpenCount, latestReportSnapshot] = await Promise.all([
    activeRunProgress(db, applicationId),
    latestOpenCycleCounts(db, applicationId),
    db.finding.count({ where: { applicationId, status: "OPEN" } }),
    latestReportSnapshotFor(db, applicationId),
  ]);
  return { applicationId: application.id, applicationName: application.name, activeRun, counts, findingsOpenCount, latestReportSnapshot };
}

export async function allDashboardSummaries(db: Db): Promise<DashboardSummary[]> {
  const applications = await db.application.findMany({ select: { id: true } });
  return Promise.all(applications.map((a) => dashboardSummary(db, a.id)));
}
