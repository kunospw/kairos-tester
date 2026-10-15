import Link from "next/link";
import { getPrisma } from "@/server/db";
import { loadCycleResults } from "@/server/services/results";
import { attentionCounts } from "@/server/services/attention-service";
import { CyclePicker } from "@/components/cycle-picker";
import { EmptyState, FlagBadge, NextStep, OutcomeBadge, OutcomeIcon, PageHeader, PriorityBadge, SimulationBanner, StatusBar } from "@/components/ui";
import { formatPercent } from "@/lib/metrics";
import { formatDateOnly } from "@/lib/dates";
import { CYCLE_KIND_LABEL, type OutcomeValue } from "@/lib/domain";

export const metadata = { title: "Results" };

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ cycle?: string }> }) {
  const { appId } = await params;
  const { cycle: cycleParam } = await searchParams;
  const db = getPrisma();
  const base = `/apps/${appId}`;
  const [cycles, caseCount, attention, liveRun] = await Promise.all([
    db.testCycle.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "desc" } }),
    db.testCase.count({ where: { applicationId: appId, archived: false } }),
    attentionCounts(db, appId),
    db.testRun.findFirst({ where: { status: "RUNNING", cycle: { applicationId: appId } }, orderBy: { createdAt: "desc" }, include: { items: { select: { status: true } } } }),
  ]);

  if (cycles.length === 0) {
    return (
      <>
        <PageHeader title="Results" />
        {caseCount ? (
          <EmptyState title="No results yet" action={<Link className="btn-primary" href={`${base}/run`}>Run tests</Link>}>
            Start a run and the AI works through your {caseCount} test cases. Results show up here as they come in.
          </EmptyState>
        ) : (
          <EmptyState title="Start by importing your checklist" action={<Link className="btn-primary" href={`${base}/cases/import`}>Import checklist</Link>}>
            An XLSX or CSV checklist. Results already recorded in it are kept as a historical round.
          </EmptyState>
        )}
      </>
    );
  }

  const defaultCycle = cycles.find((c) => c.kind !== "SIMULATION") ?? cycles[0];
  const selected = cycles.find((c) => c.id === cycleParam) ?? defaultCycle;
  const res = await loadCycleResults(db, selected.id);
  const m = res.metrics;

  const failures = res.rows.filter((r) => r.outcome === "FAIL");
  const blocked = res.rows.filter((r) => r.outcome === "BLOCKED");
  const highOpen = res.rows.filter((r) => r.priority === "HIGH" && r.outcome === "NOT_RUN");
  const partial = res.rows.filter((r) => r.partialCoverage || r.openIncompleteFlags > 0);
  const groups = [
    { title: "Failed", rows: failures, reason: true },
    { title: "Blocked", rows: blocked, reason: true },
    { title: "High priority, not tested yet", rows: highOpen },
    { title: "Passed with gaps in coverage", rows: partial, flags: true },
  ].filter((g) => g.rows.length > 0);

  const recent = await db.executionAttempt.findMany({
    where: { status: "COMPLETED", cycleCase: { cycleId: selected.id } },
    orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { executedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 8,
    include: { cycleCase: { include: { testCase: true } }, caseVersion: true },
  });

  return (
    <div>
      <PageHeader
        title="Results"
        subtitle={
          <>
            {CYCLE_KIND_LABEL[selected.kind]} · {res.cycle.environment?.name ?? "environment not recorded"}
            {selected.buildLabel ? ` · build ${selected.buildLabel}` : ""}
          </>
        }
        actions={
          <>
            <CyclePicker cycles={cycles} value={selected.id} label="Round" />
            <Link className="btn-ghost" href={`${base}/cycles`}>All rounds</Link>
          </>
        }
      />

      <Next base={base} needsYou={attention.needsYou} liveRun={liveRun} notRun={m.NOT_RUN} open={selected.status === "OPEN" && selected.kind !== "HISTORICAL_IMPORT"} />
      {res.simulation && <div className="mb-6"><SimulationBanner /></div>}

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {m.PASS + m.FAIL + m.BLOCKED} <span className="text-base font-normal text-slate-500">of {m.applicable} tested</span>
          </p>
          <p className="text-sm text-slate-600">
            Pass rate <strong className="tabular-nums text-ink-900">{formatPercent(m.passRate, "—")}</strong>
            <span className="text-slate-500"> · </span>
            Coverage <strong className="tabular-nums text-ink-900">{formatPercent(m.coverage, "—")}</strong>
            {m.NOT_APPLICABLE > 0 && <span className="text-slate-500"> · {m.NOT_APPLICABLE} N/A excluded</span>}
          </p>
        </div>
        <StatusBar pass={m.PASS} fail={m.FAIL} blocked={m.BLOCKED} notRun={m.NOT_RUN} />
        <p className="mt-2 text-xs text-slate-500">
          Pass rate = Pass ÷ (Pass + Fail). It does not say whether the build is ready to release.
        </p>
      </section>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          {groups.length === 0 ? (
            <p className="rounded-lg border border-slate-200 px-4 py-6 text-sm text-slate-500">Nothing failed or blocked in this round.</p>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {groups.map((g) => (
                <div key={g.title} className="px-4 py-3">
                  <p className="mb-1.5 text-xs font-medium text-slate-500">
                    {g.title} <span className="tabular-nums">({g.rows.length})</span>
                  </p>
                  <ul className="space-y-1.5">
                    {g.rows.slice(0, 8).map((r) => (
                      <li key={r.cycleCaseId} className="flex items-start gap-2 text-sm">
                        <span className="mt-[3px]"><OutcomeIcon outcome={r.outcome as OutcomeValue} /></span>
                        <Link href={`${base}/cycles/${selected.id}/run/${r.cycleCaseId}`} className="case-id inline-flex min-h-6 shrink-0 items-center hover:underline">{r.externalId}</Link>
                        <span className="min-w-0 flex-1">
                          <span className="text-ink-800">{r.version.title}</span>
                          {g.reason && (r.latestCompleted?.outcomeReason || r.latestCompleted?.remarks) && (
                            <span className="block truncate text-xs text-slate-500">{r.latestCompleted?.outcomeReason || r.latestCompleted?.remarks}</span>
                          )}
                          {g.flags && r.partialCoverage && r.latestCompleted?.partialCoverageNote && (
                            <span className="block truncate text-xs text-slate-500">Not covered: {r.latestCompleted.partialCoverageNote}</span>
                          )}
                          {g.flags && r.openFindings.filter((f) => f.type === "INCOMPLETE_TESTING").map((f) => <FlagBadge key={f.id} type={f.type} title={f.message} />)}
                        </span>
                        <PriorityBadge priority={r.priority} />
                      </li>
                    ))}
                    {g.rows.length > 8 && (
                      <li className="text-xs text-slate-500">
                        and {g.rows.length - 8} more in <Link className="underline" href={`${base}/cycles/${selected.id}`}>the full round</Link>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">By section</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Section</th>
                  <th className="hidden w-1/3 sm:table-cell">Progress</th>
                  <th className="text-right">Pass</th>
                  <th className="text-right">Fail</th>
                  <th className="text-right">Blocked</th>
                  <th className="text-right">Not run</th>
                </tr>
              </thead>
              <tbody>
                {res.bySection.map(({ section, metrics: s }) => (
                  <tr key={section}>
                    <td className="max-w-56">{section}</td>
                    <td className="hidden align-middle sm:table-cell"><StatusBar pass={s.PASS} fail={s.FAIL} blocked={s.BLOCKED} notRun={s.NOT_RUN} legend={false} height={6} /></td>
                    <td className="text-right tabular-nums">{s.PASS}</td>
                    <td className={`text-right tabular-nums ${s.FAIL ? "font-semibold text-red-700" : "text-slate-500"}`}>{s.FAIL}</td>
                    <td className={`text-right tabular-nums ${s.BLOCKED ? "font-semibold text-amber-700" : "text-slate-500"}`}>{s.BLOCKED}</td>
                    <td className="text-right tabular-nums text-slate-500">{s.NOT_RUN}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Latest results in this round</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr><th>Date</th><th>Case</th><th>Result</th><th>By</th><th>How</th></tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-slate-600">{formatDateOnly(a.executedOn)}</td>
                    <td>
                      <Link className="case-id inline-flex min-h-6 items-center hover:underline" href={`${base}/cycles/${selected.id}/run/${a.cycleCaseId}`}>{a.cycleCase.testCase.externalId}</Link>{" "}
                      <span className="text-ink-800">{a.caseVersion.title}</span>
                    </td>
                    <td>{a.outcome && <OutcomeBadge outcome={a.outcome as OutcomeValue} />}</td>
                    <td className="text-slate-600">{a.executionMethod === "AI_DRIVEN" && !a.humanCheckpointBy ? "AI (verified)" : (a.humanCheckpointBy ?? a.tester ?? "unknown")}</td>
                    <td className="text-xs text-slate-500">{a.source === "IMPORT" ? "Imported" : a.source === "AI_AGENT" ? "AI run" : a.source === "SIMULATION" ? "Simulated" : "Manual"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/** The single most useful next action, in priority order. */
function Next({
  base,
  needsYou,
  liveRun,
  notRun,
  open,
}: {
  base: string;
  needsYou: number;
  liveRun: { id: string; items: { status: string }[] } | null;
  notRun: number;
  open: boolean;
}) {
  if (needsYou > 0) {
    return (
      <NextStep title={`${needsYou} thing${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} your decision`} action={<Link className="btn-primary" href={`${base}/inbox`}>Open Needs you</Link>}>
        Questions from the AI and results it couldn&apos;t confirm by itself.
      </NextStep>
    );
  }
  if (liveRun) {
    const left = liveRun.items.filter((i) => i.status === "QUEUED" || i.status === "RUNNING").length;
    return (
      <NextStep title={`A run is in progress: ${liveRun.items.length - left} of ${liveRun.items.length} done`} action={<Link className="btn-secondary" href={`${base}/run/${liveRun.id}`}>Watch the run</Link>}>
        You can leave this page; anything that needs you will show up in Needs you.
      </NextStep>
    );
  }
  if (open && notRun > 0) {
    return (
      <NextStep title={`${notRun} case${notRun === 1 ? "" : "s"} not tested yet in this round`} action={<Link className="btn-primary" href={`${base}/run`}>Run tests</Link>}>
        The AI picks up where you left off; results already recorded stay.
      </NextStep>
    );
  }
  return (
    <NextStep title="Nothing waiting on you" action={<Link className="btn-secondary" href={`${base}/reports`}>Create a report</Link>}>
      Share this round&apos;s results, or start a new round from Run tests when there is a new build.
    </NextStep>
  );
}
