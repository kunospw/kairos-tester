import Link from "next/link";
import { getPrisma } from "@/server/db";
import { loadCycleResults } from "@/server/services/results";
import { CyclePicker } from "@/components/cycle-picker";
import {
  Card,
  EmptyState,
  FlagBadge,
  LifecycleBadge,
  OutcomeBadge,
  PageHeader,
  PriorityBadge,
  SimulationBanner,
  StatCard,
  TextLink,
} from "@/components/ui";
import { formatPercent } from "@/lib/metrics";
import { formatDateOnly } from "@/lib/dates";
import { CYCLE_KIND_LABEL, EXECUTION_METHOD_LABEL, type AttemptStatusValue, type OutcomeValue } from "@/lib/domain";

export const metadata = { title: "Results" };

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { appId } = await params;
  const { cycle: cycleParam } = await searchParams;
  const db = getPrisma();
  const cycles = await db.testCycle.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "desc" } });
  const caseCount = await db.testCase.count({ where: { applicationId: appId } });

  if (cycles.length === 0) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState
          title={caseCount ? "No results yet" : "Nothing to show yet"}
          action={
            <div className="flex gap-2">
              {caseCount ? (
                <Link className="btn-accent" href={`/apps/${appId}/run`}>▶ Run tests</Link>
              ) : (
                <Link className="btn-accent" href={`/apps/${appId}/cases/import`}>Import checklist</Link>
              )}
              <Link className="btn-secondary" href={`/apps/${appId}/cycles`}>Record results by hand</Link>
            </div>
          }
        >
          {caseCount
            ? "Start a run and the AI tests what it can; results appear here."
            : "Import a checklist (its recorded results become a historical cycle), then run tests."}
        </EmptyState>
      </>
    );
  }

  const defaultCycle = cycles.find((c) => c.kind !== "SIMULATION") ?? cycles[0];
  const selected = cycles.find((c) => c.id === cycleParam) ?? defaultCycle;
  const res = await loadCycleResults(db, selected.id);
  const m = res.metrics;

  const failures = res.rows.filter((r) => r.outcome === "FAIL");
  const blockers = res.rows.filter((r) => r.outcome === "BLOCKED");
  const partial = res.rows.filter((r) => r.partialCoverage || r.openIncompleteFlags > 0);
  const highOutstanding = res.rows.filter((r) => r.priority === "HIGH" && r.outcome !== "PASS" && r.outcome !== "NOT_APPLICABLE");
  const inProgress = res.rows.filter((r) => r.lifecycle);

  const recent = await db.executionAttempt.findMany({
    where: {
      status: "COMPLETED",
      cycleCase: { cycle: res.simulation ? { id: selected.id } : { applicationId: appId, kind: { not: "SIMULATION" } } },
      ...(res.simulation ? {} : { isSimulated: false }),
    },
    orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { executedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 12,
    include: { cycleCase: { include: { testCase: true, cycle: true } }, caseVersion: true },
  });

  const base = `/apps/${appId}`;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Results"
        subtitle={
          <span>
            {CYCLE_KIND_LABEL[selected.kind]} · Environment: <strong>{res.cycle.environment?.name ?? "not recorded"}</strong> · Build:{" "}
            <strong>{selected.buildLabel ?? "not recorded"}</strong>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <CyclePicker cycles={cycles} value={selected.id} />
            <Link className="text-sm text-teal-700 hover:underline" href={`${base}/cycles`}>All cycles</Link>
          </div>
        }
      />
      {res.simulation && <SimulationBanner />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Cases in cycle" value={m.total} hint={`${m.applicable} applicable (N/A excluded)`} />
        <StatCard label="Pass" value={m.PASS} tone="good" />
        <StatCard label="Fail" value={m.FAIL} tone={m.FAIL ? "bad" : "default"} />
        <StatCard label="Blocked" value={m.BLOCKED} tone={m.BLOCKED ? "warn" : "default"} />
        <StatCard label="Not run" value={m.NOT_RUN} />
        <StatCard label="N/A" value={m.NOT_APPLICABLE} />
        <StatCard label="Partial coverage" value={m.partialCoverage} tone={m.partialCoverage ? "warn" : "default"} hint="flagged for review" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Coverage" value={formatPercent(m.coverage, "No applicable cases")} hint="Completed Pass/Fail ÷ applicable cases" />
        <StatCard label="Pass rate" value={formatPercent(m.passRate)} hint="Pass ÷ (Pass + Fail). Not a release-readiness measure." />
        <StatCard label="Customer acceptance" value="Not recorded" hint="Recorded separately from pass rate" />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Results by section">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Section</th>
                  <th className="text-right">Cases</th>
                  <th className="text-right">Pass</th>
                  <th className="text-right">Fail</th>
                  <th className="text-right">Blocked</th>
                  <th className="text-right">Not run</th>
                  <th className="text-right">N/A</th>
                  <th className="text-right">Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {res.bySection.map(({ section, metrics: s }) => (
                  <tr key={section}>
                    <td className="max-w-64">{section}</td>
                    <td className="text-right">{s.total}</td>
                    <td className="text-right">{s.PASS}</td>
                    <td className={`text-right ${s.FAIL ? "font-semibold text-red-700" : ""}`}>{s.FAIL}</td>
                    <td className={`text-right ${s.BLOCKED ? "font-semibold text-amber-800" : ""}`}>{s.BLOCKED}</td>
                    <td className="text-right">{s.NOT_RUN}</td>
                    <td className="text-right">{s.NOT_APPLICABLE}</td>
                    <td className="whitespace-nowrap text-right text-xs">{formatPercent(s.passRate, "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Computed from case and result records, not cached spreadsheet totals. “—” means no completed tests in that section.</p>
        </Card>

        <div className="space-y-5">
          <IssueList title={`High-priority outstanding (${highOutstanding.length})`} rows={highOutstanding} base={base} cycleId={selected.id} empty="No high-priority cases outstanding." />
          <IssueList title={`Failures (${failures.length})`} rows={failures} base={base} cycleId={selected.id} empty="No failed cases." showReason />
          <IssueList title={`Blocked (${blockers.length})`} rows={blockers} base={base} cycleId={selected.id} empty="No blocked cases." showReason />
          <IssueList title={`Partial coverage / incomplete testing (${partial.length})`} rows={partial} base={base} cycleId={selected.id} empty="No partial-coverage flags." showFlags />
          {inProgress.length > 0 && <IssueList title={`In progress (${inProgress.length})`} rows={inProgress} base={base} cycleId={selected.id} empty="" />}
        </div>
      </div>

      <Card title="Recent execution history">
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500">No completed executions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Case</th>
                  <th>Cycle</th>
                  <th>Result</th>
                  <th>Tester</th>
                  <th>Method</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{formatDateOnly(a.executedOn)}</td>
                    <td>
                      <TextLink href={`${base}/cases/${a.cycleCase.testCaseId}`}>{a.cycleCase.testCase.externalId}</TextLink>{" "}
                      <span className="text-slate-600">{a.caseVersion.title}</span>
                    </td>
                    <td className="text-xs">{a.cycleCase.cycle.name}</td>
                    <td>{a.outcome && <OutcomeBadge outcome={a.outcome as OutcomeValue} />}</td>
                    <td>{a.tester ?? <span className="text-slate-400">unknown</span>}</td>
                    <td className="text-xs">{EXECUTION_METHOD_LABEL[a.executionMethod]}</td>
                    <td className="text-xs">{a.source === "IMPORT" ? "Imported" : a.source === "SIMULATION" ? "Simulated" : "Recorded here"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof loadCycleResults>>["rows"][number];

function IssueList({
  title,
  rows,
  base,
  cycleId,
  empty,
  showReason,
  showFlags,
}: {
  title: string;
  rows: Row[];
  base: string;
  cycleId: string;
  empty: string;
  showReason?: boolean;
  showFlags?: boolean;
}) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 12).map((r) => (
            <li key={r.cycleCaseId} className="flex flex-wrap items-start gap-2 py-1.5 text-sm">
              <OutcomeBadge outcome={r.outcome} />
              {r.lifecycle && <LifecycleBadge status={r.lifecycle as AttemptStatusValue} />}
              <PriorityBadge priority={r.priority} />
              <Link href={`${base}/cycles/${cycleId}/run/${r.cycleCaseId}`} className="font-medium text-teal-700 hover:underline">
                {r.externalId}
              </Link>
              <span className="min-w-0 flex-1 text-slate-700">
                {r.version.title}
                {showReason && (r.latestCompleted?.outcomeReason || r.latestCompleted?.remarks) && (
                  <span className="block text-xs text-slate-500">{(r.latestCompleted?.outcomeReason || r.latestCompleted?.remarks)?.slice(0, 220)}</span>
                )}
                {showFlags && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {r.partialCoverage && <FlagBadge type="INCOMPLETE_TESTING" title={r.latestCompleted?.partialCoverageNote ?? ""} />}
                    {r.openFindings
                      .filter((f) => f.type === "INCOMPLETE_TESTING")
                      .map((f) => (
                        <FlagBadge key={f.id} type={f.type} title={f.message} />
                      ))}
                    {r.latestCompleted?.source === "IMPORT" && <span className="text-xs text-slate-500">imported result preserved</span>}
                  </span>
                )}
              </span>
            </li>
          ))}
          {rows.length > 12 && <li className="pt-2 text-xs text-slate-500">…and {rows.length - 12} more. See the cycle for the full list.</li>}
        </ul>
      )}
    </Card>
  );
}
