import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";
import { loadCycleResults } from "@/server/services/results";
import { PageHeader, SimulationBanner, StatCard } from "@/components/ui";
import { CycleCaseTable, type CycleRow } from "@/components/cycle-case-table";
import { CycleSettings } from "@/components/cycle-settings";
import { formatPercent } from "@/lib/metrics";
import { formatDateOnly } from "@/lib/dates";
import { CYCLE_KIND_LABEL, type AttemptStatusValue, type ExecutionModeValue } from "@/lib/domain";

export const metadata = { title: "Cycle" };

export default async function CyclePage({ params }: { params: Promise<{ appId: string; cycleId: string }> }) {
  const { appId, cycleId } = await params;
  const db = getPrisma();
  const cycle = await db.testCycle.findFirst({ where: { id: cycleId, applicationId: appId } });
  if (!cycle) notFound();
  const [res, environments] = await Promise.all([
    loadCycleResults(db, cycleId),
    db.environment.findMany({ where: { applicationId: appId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const m = res.metrics;
  const rows: CycleRow[] = res.rows.map((r) => ({
    cycleCaseId: r.cycleCaseId,
    testCaseId: r.testCaseId,
    externalId: r.externalId,
    title: r.version.title,
    section: r.section,
    priority: r.priority,
    role: r.role,
    environment: r.environment,
    mode: r.executionMode as ExecutionModeValue,
    outcome: r.outcome,
    lifecycle: r.lifecycle as AttemptStatusValue | null,
    attempts: r.attemptCount,
    evidence: r.evidenceCount,
    flags: r.openFindings.length,
    partial: r.partialCoverage,
    lastTester: r.latestCompleted?.tester ?? null,
    lastDate: r.latestCompleted?.executedOn ? formatDateOnly(r.latestCompleted.executedOn) : null,
    imported: r.latestCompleted?.source === "IMPORT",
    versionNumber: r.version.versionNumber,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={cycle.name}
        subtitle={
          <span>
            {CYCLE_KIND_LABEL[cycle.kind]} · Environment <strong>{res.cycle.environment?.name ?? "not recorded"}</strong>
            {res.cycle.environment?.targetUrl && <> ({res.cycle.environment.targetUrl})</>} · Build <strong>{cycle.buildLabel ?? "not recorded"}</strong> ·{" "}
            {cycle.status === "OPEN" ? "Open" : "Closed"}
          </span>
        }
        actions={
          <>
            <Link className="btn-secondary" href={`/apps/${appId}/cycles`}>← All cycles</Link>
            <Link className="btn-secondary" href={`/apps/${appId}?cycle=${cycle.id}`}>Overview</Link>
            {cycle.kind !== "SIMULATION" && <Link className="btn-primary" href={`/apps/${appId}/reports?cycle=${cycle.id}`}>Create report</Link>}
          </>
        }
      />
      {res.simulation && <SimulationBanner />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Cases" value={m.total} />
        <StatCard label="Pass" value={m.PASS} tone="good" />
        <StatCard label="Fail" value={m.FAIL} tone={m.FAIL ? "bad" : "default"} />
        <StatCard label="Blocked" value={m.BLOCKED} tone={m.BLOCKED ? "warn" : "default"} />
        <StatCard label="Not run" value={m.NOT_RUN} />
        <StatCard label="N/A" value={m.NOT_APPLICABLE} />
        <StatCard label="Coverage" value={formatPercent(m.coverage, "—")} />
        <StatCard label="Pass rate" value={formatPercent(m.passRate, "No completed tests")} />
      </div>
      <CycleSettings
        appId={appId}
        cycle={{
          id: cycle.id,
          buildLabel: cycle.buildLabel,
          environmentId: cycle.environmentId,
          scope: cycle.scope,
          excludedScope: cycle.excludedScope,
          status: cycle.status,
        }}
        environments={environments}
      />
      <CycleCaseTable appId={appId} cycleId={cycle.id} rows={rows} simulation={res.simulation} closed={cycle.status === "CLOSED"} />
    </div>
  );
}
