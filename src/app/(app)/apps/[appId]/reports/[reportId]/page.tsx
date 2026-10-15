import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";
import { aiConfig } from "@/server/ai/ollama";
import { FlagBadge, OutcomeBadge, PriorityBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ReportSummaryPanel } from "@/components/report-summary-panel";
import { formatPercent } from "@/lib/metrics";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { OUTCOME_LABEL, type OutcomeValue } from "@/lib/domain";
import type { ReportCase, ReportData } from "@/server/services/report-service";

export const metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ appId: string; reportId: string }> }) {
  const { appId, reportId } = await params;
  const report = await getPrisma().reportSnapshot.findFirst({ where: { id: reportId, cycle: { applicationId: appId } } });
  if (!report) notFound();
  const d = report.data as unknown as ReportData;
  const m = d.metrics;
  const failed = d.cases.filter((c) => c.outcome === "FAIL");
  const blocked = d.cases.filter((c) => c.outcome === "BLOCKED");
  const highOutstanding = d.cases.filter((c) => c.priority === "HIGH" && c.outcome !== "PASS" && c.outcome !== "NOT_APPLICABLE");
  const incomplete = d.cases.filter((c) => c.partialCoverage || c.flags.some((f) => f.type === "INCOMPLETE_TESTING"));
  const withEvidence = d.cases.filter((c) => c.evidence.length > 0);
  const imported = d.cases.filter((c) => c.source === "IMPORT").length;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link className="btn-secondary" href={`/apps/${appId}/reports`}>← Reports</Link>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/apps/${appId}/reports/${report.id}/csv`}>Export CSV</a>
          <PrintButton />
        </div>
      </div>
      <div className="no-print">
        <ReportSummaryPanel appId={appId} reportId={report.id} enabled={aiConfig().keyConfigured} hasSummary={Boolean(report.aiSummary)} />
      </div>

      <article className="card space-y-6 p-6 print:border-0 print:p-0">
        <header className="border-b border-slate-200 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Test results report</p>
          <h1 className="mt-1 text-2xl font-semibold text-navy-900">{report.title}</h1>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2"><dt className="text-slate-500">Application</dt><dd className="font-medium">{d.application.name}</dd></div>
            <div className="flex gap-2"><dt className="text-slate-500">Cycle</dt><dd className="font-medium">{d.cycle.name}</dd></div>
            <div className="flex gap-2"><dt className="text-slate-500">Build</dt><dd className="font-medium">{d.cycle.buildLabel ?? "Not recorded"}</dd></div>
            <div className="flex gap-2"><dt className="text-slate-500">Environment</dt><dd className="font-medium">{d.environment ? `${d.environment.name} (${d.environment.type.toLowerCase()})` : "Not recorded"}</dd></div>
            <div className="flex gap-2"><dt className="text-slate-500">Results as of</dt><dd className="font-medium">{formatDateTime(d.generatedAt)}</dd></div>
            <div className="flex gap-2"><dt className="text-slate-500">Prepared by</dt><dd className="font-medium">{report.createdBy}</dd></div>
          </dl>
        </header>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-navy-900">Scope</h2>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div><p className="label">Included</p><p className="prewrap">{report.includedScope || "Not stated"}</p></div>
            <div><p className="label">Excluded</p><p className="prewrap">{report.excludedScope || "Not stated"}</p></div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-navy-900">Results at a glance</h2>
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {([
              ["Total", m.total],
              ["Pass", m.PASS],
              ["Fail", m.FAIL],
              ["Blocked", m.BLOCKED],
              ["Not run", m.NOT_RUN],
              ["N/A", m.NOT_APPLICABLE],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded border border-slate-200 py-2">
                <p className="text-xs text-slate-500">{k}</p>
                <p className="text-xl font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Coverage (Pass + Fail ÷ applicable)</dt>
              <dd className="text-lg font-semibold">{formatPercent(m.coverage, "No applicable cases")}</dd>
            </div>
            <div className="rounded bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Pass rate (Pass ÷ Pass + Fail)</dt>
              <dd className="text-lg font-semibold">{formatPercent(m.passRate)}</dd>
            </div>
            <div className="rounded bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Customer acceptance</dt>
              <dd className="text-lg font-semibold">Not recorded</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate-600">
            N/A cases are excluded from coverage and pass rate. Not run and Blocked cases are shown separately. A high pass rate does not by itself mean the release is ready:
            see outstanding work, blockers and partial-coverage flags below.
            {m.partialCoverage > 0 && <strong> {m.partialCoverage} case(s) carry partial-coverage flags.</strong>}
            {imported > 0 && ` ${imported} result(s) are imported historical records (build and execution method unknown).`}
          </p>
        </section>

        {report.aiSummary && (
          <section>
            <h2 className="mb-2 text-lg font-semibold text-navy-900">Summary</h2>
            <p className="prewrap text-sm">{report.aiSummary}</p>
            <p className="mt-1 text-xs text-slate-500">
              Drafted with AI assistance from the recorded results and {report.aiSummaryReviewed ? `reviewed by ${report.aiSummaryReviewedBy}` : "NOT yet human-reviewed"}.
            </p>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-lg font-semibold text-navy-900">Results by section</h2>
          <table className="table-base">
            <thead>
              <tr><th>Section</th><th className="text-right">Cases</th><th className="text-right">Pass</th><th className="text-right">Fail</th><th className="text-right">Blocked</th><th className="text-right">Not run</th><th className="text-right">N/A</th></tr>
            </thead>
            <tbody>
              {d.bySection.map(({ section, metrics: s }) => (
                <tr key={section}>
                  <td>{section}</td>
                  <td className="text-right">{s.total}</td>
                  <td className="text-right">{s.PASS}</td>
                  <td className="text-right">{s.FAIL}</td>
                  <td className="text-right">{s.BLOCKED}</td>
                  <td className="text-right">{s.NOT_RUN}</td>
                  <td className="text-right">{s.NOT_APPLICABLE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <CaseSection title={`Failed cases (${failed.length})`} cases={failed} empty="No failed cases." detail />
        <CaseSection title={`Blocked cases (${blocked.length})`} cases={blocked} empty="No blocked cases." detail />
        <CaseSection title={`High-priority work outstanding (${highOutstanding.length})`} cases={highOutstanding} empty="None." />
        <CaseSection title={`Incomplete coverage flags (${incomplete.length})`} cases={incomplete} empty="None." showFlags />

        <section>
          <h2 className="mb-2 text-lg font-semibold text-navy-900">Available evidence ({withEvidence.length} cases)</h2>
          {withEvidence.length === 0 ? (
            <p className="text-sm text-slate-500">No evidence files are attached to the reported results.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {withEvidence.map((c) => (
                <li key={c.cycleCaseId}>
                  <strong>{c.externalId}</strong>:{" "}
                  {c.evidence.map((e, i) => (
                    <span key={e.id}>
                      {i > 0 && ", "}
                      <a className="text-teal-700 underline" href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer">{e.name}</a>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-slate-500">Evidence links require sign-in to Kairos Tester.</p>
        </section>

        <section className="print-break">
          <h2 className="mb-2 text-lg font-semibold text-navy-900">All cases: expected vs actual</h2>
          <table className="table-base text-xs">
            <thead>
              <tr><th>ID</th><th>Case</th><th>Result</th><th>Expected</th><th>Actual / notes</th><th>Tested</th></tr>
            </thead>
            <tbody>
              {d.cases.map((c) => (
                <tr key={c.cycleCaseId} className="break-inside-avoid">
                  <td className="whitespace-nowrap font-medium">{c.externalId}</td>
                  <td className="min-w-40">{c.title}<div className="text-slate-500">{c.section}</div></td>
                  <td>
                    <OutcomeBadge outcome={c.outcome as OutcomeValue} />
                    {c.partialCoverage && <div className="mt-1 text-orange-900">partial</div>}
                  </td>
                  <td className="prewrap max-w-xs">{c.expected ?? "—"}</td>
                  <td className="prewrap max-w-xs">
                    {c.reason && <p><strong>Reason:</strong> {c.reason}</p>}
                    {c.actual && <p>{c.actual}</p>}
                    {c.remarks && <p>{c.remarks}</p>}
                    {!c.reason && !c.actual && !c.remarks && "—"}
                  </td>
                  <td className="whitespace-nowrap">
                    {c.executedOn ? formatDateOnly(c.executedOn) : "—"}
                    <div className="text-slate-500">{c.tester ?? ""}</div>
                    {c.source === "IMPORT" && <div className="text-slate-500">imported</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500">
          Generated by Kairos Tester from recorded results. Snapshot {report.id} · results as of {formatDateTime(d.generatedAt)}. Outcomes: {Object.values(OUTCOME_LABEL).join(", ")}.
        </footer>
      </article>
    </div>
  );
}

function CaseSection({ title, cases, empty, detail, showFlags }: { title: string; cases: ReportCase[]; empty: string; detail?: boolean; showFlags?: boolean }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-navy-900">{title}</h2>
      {cases.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {cases.map((c) => (
            <li key={c.cycleCaseId} className="break-inside-avoid p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <OutcomeBadge outcome={c.outcome} />
                <PriorityBadge priority={c.priority} />
                <strong>{c.externalId}</strong> {c.title}
              </div>
              {detail && (
                <div className="mt-1 grid gap-2 text-xs sm:grid-cols-2">
                  <div><p className="font-semibold text-slate-600">Expected</p><p className="prewrap">{c.expected ?? "—"}</p></div>
                  <div><p className="font-semibold text-slate-600">Actual / reason</p><p className="prewrap">{[c.reason, c.actual, c.remarks].filter(Boolean).join("\n") || "—"}</p></div>
                </div>
              )}
              {showFlags && (
                <div className="mt-1 space-y-1 text-xs">
                  {c.partialCoverage && <p><FlagBadge type="INCOMPLETE_TESTING" /> {c.partialCoverageNote}</p>}
                  {c.flags.filter((f) => f.type === "INCOMPLETE_TESTING").map((f, i) => <p key={i}><FlagBadge type={f.type} /> {f.message}</p>)}
                  {c.source === "IMPORT" && <p className="text-slate-500">Imported result kept as recorded: {c.remarks}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
