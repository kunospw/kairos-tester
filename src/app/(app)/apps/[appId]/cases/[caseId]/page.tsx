import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";
import { Alert, Card, FlagBadge, LifecycleBadge, ModeBadge, OutcomeBadge, PageHeader, Prewrap, PriorityBadge, TextLink } from "@/components/ui";
import { FindingActions } from "@/components/finding-actions";
import { AutomationBindingForm } from "@/components/automation-binding-form";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import {
  CYCLE_KIND_LABEL,
  EXECUTION_METHOD_LABEL,
  type AttemptStatusValue,
  type ExecutionModeValue,
  type OutcomeValue,
  type PriorityValue,
} from "@/lib/domain";

export const metadata = { title: "Test case" };

const SOURCE_LABEL: Record<string, string> = {
  IMPORT: "Imported",
  IMPORT_UPDATE: "Reviewed re-import",
  MANUAL: "Manual edit",
  AI_PROPOSAL: "Accepted AI proposal",
};

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string; caseId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { appId, caseId } = await params;
  const { saved } = await searchParams;
  const db = getPrisma();
  const tc = await db.testCase.findFirst({
    where: { id: caseId, applicationId: appId },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, include: { importRow: { include: { batch: true } } } },
      automation: true,
      findings: { orderBy: { createdAt: "desc" } },
      cycleCases: {
        include: {
          cycle: true,
          caseVersion: true,
          attempts: {
            orderBy: { attemptNumber: "desc" },
            include: { evidence: { orderBy: { createdAt: "asc" } }, caseVersion: true, stepOutcomes: { orderBy: { stepIndex: "asc" } } },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!tc) notFound();
  const current = tc.versions[0];
  const base = `/apps/${appId}`;
  const steps = (current.steps as { text: string; required: boolean }[]) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${tc.externalId} · ${current.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={current.priority as PriorityValue} />
            <ModeBadge mode={current.executionMode as ExecutionModeValue} />
            <span>Version {current.versionNumber}</span>
            <span>· Origin: {tc.origin === "IMPORT" ? "imported" : tc.origin === "AI_PROPOSAL" ? "accepted AI proposal" : "created here"}</span>
            {current.categories.map((c) => <span key={c} className="rounded bg-slate-100 px-1.5 text-xs">{c}</span>)}
          </span>
        }
        actions={
          <>
            <Link className="btn-secondary" href={`${base}/cases`}>← All cases</Link>
            <Link className="btn-primary" href={`${base}/cases/${tc.id}/edit`}>Edit (new version)</Link>
          </>
        }
      />
      {saved && <Alert kind="success" title={`Saved as version ${current.versionNumber}.`}>Earlier versions and executions are unchanged.</Alert>}
      {current.executionMode === "UNKNOWN" && (
        <Alert kind="info">Execution mode not reviewed yet. Imported cases keep an unknown mode until someone reviews them; edit the case to set Manual, Automated or Hybrid.</Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title={`Current definition (v${current.versionNumber})`} className="xl:col-span-2">
          <dl className="grid gap-4 text-sm md:grid-cols-3">
            <div><dt className="label">Section</dt><dd>{current.section ?? "—"}</dd></div>
            <div><dt className="label">Role</dt><dd>{current.role ?? "—"}</dd></div>
            <div><dt className="label">Environment</dt><dd>{current.environment ?? "—"}</dd></div>
            {current.dependsOn && <div className="md:col-span-3"><dt className="label">Depends on</dt><dd>{current.dependsOn}</dd></div>}
            <div className="md:col-span-3"><dt className="label">Preconditions</dt><dd><Prewrap text={current.preconditions} /></dd></div>
            <div className="md:col-span-3">
              <dt className="label">Steps / checks</dt>
              <dd>
                {steps.length ? (
                  <ol className="list-decimal space-y-1 pl-5">
                    {steps.map((s, i) => (
                      <li key={i} className="prewrap">
                        {s.text} {!s.required && <span className="text-xs text-slate-500">(optional)</span>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Prewrap text={current.stepsText} />
                )}
              </dd>
            </div>
            <div className="md:col-span-2"><dt className="label">Expected result</dt><dd><Prewrap text={current.expectedResult} /></dd></div>
            <div><dt className="label">Test data</dt><dd><Prewrap text={current.testData} /></dd></div>
          </dl>
        </Card>

        <div className="space-y-5">
          <Card title={`Review flags (${tc.findings.filter((f) => f.status === "OPEN").length} open)`}>
            {tc.findings.length === 0 ? (
              <p className="text-sm text-slate-500">No review flags.</p>
            ) : (
              <ul className="space-y-3">
                {tc.findings.map((f) => (
                  <li key={f.id} className="rounded border border-slate-200 p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <FlagBadge type={f.type} />
                      <span className="text-xs text-slate-500">
                        {f.source === "IMPORT_RULE" ? "Import rule" : f.source === "AI_REVIEW" ? "Accepted AI review" : "Manual"} · {f.status.toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-1">{f.message}</p>
                    {f.evidenceExcerpt && <blockquote className="prewrap mt-1 border-l-2 border-slate-300 pl-2 text-xs text-slate-600">{f.evidenceExcerpt}</blockquote>}
                    {f.resolutionNote && <p className="mt-1 text-xs text-slate-600">Resolution: {f.resolutionNote}</p>}
                    <FindingActions appId={appId} findingId={f.id} status={f.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Automation binding">
            <AutomationBindingForm appId={appId} caseId={tc.id} binding={tc.automation} />
          </Card>
        </div>
      </div>

      <Card title="Execution history (all cycles)">
        {tc.cycleCases.length === 0 ? (
          <p className="text-sm text-slate-500">This case is not in any cycle yet.</p>
        ) : (
          <div className="space-y-4">
            {tc.cycleCases.map((cc) => (
              <div key={cc.id} className="rounded border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <span>
                    <strong>{cc.cycle.name}</strong> <span className="text-xs text-slate-500">({CYCLE_KIND_LABEL[cc.cycle.kind]}) · assigned v{cc.caseVersion.versionNumber}</span>
                  </span>
                  <TextLink href={`${base}/cycles/${cc.cycleId}/run/${cc.id}`}>Open in cycle →</TextLink>
                </div>
                {cc.attempts.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-500">Not run in this cycle.{cc.importNotes ? ` Imported note: ${cc.importNotes}` : ""}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Result</th>
                          <th>Version used</th>
                          <th>Tester</th>
                          <th>Date</th>
                          <th>Method / source</th>
                          <th>Notes</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cc.attempts.map((a) => (
                          <tr key={a.id} className={a.isSimulated ? "bg-purple-50/50" : ""}>
                            <td>{a.attemptNumber}</td>
                            <td>
                              <div className="flex flex-col items-start gap-1">
                                {a.status === "COMPLETED" && a.outcome ? <OutcomeBadge outcome={a.outcome as OutcomeValue} /> : <LifecycleBadge status={a.status as AttemptStatusValue} />}
                                {a.partialCoverage && <FlagBadge type="INCOMPLETE_TESTING" title={a.partialCoverageNote ?? ""} />}
                              </div>
                            </td>
                            <td>v{a.caseVersion.versionNumber}</td>
                            <td>{a.tester ?? <span className="text-slate-400">unknown</span>}</td>
                            <td className="whitespace-nowrap">{a.completedAt ? formatDateTime(a.completedAt) : formatDateOnly(a.executedOn)}</td>
                            <td className="text-xs">
                              {EXECUTION_METHOD_LABEL[a.executionMethod]}
                              <br />
                              <span className="text-slate-500">{a.source === "IMPORT" ? "imported historical" : a.source === "SIMULATION" ? "SIMULATED" : "recorded here"}</span>
                              {a.source === "IMPORT" && <span className="block text-slate-500">build unknown</span>}
                            </td>
                            <td className="max-w-md text-xs">
                              {a.outcomeReason && <p><strong>Reason:</strong> {a.outcomeReason}</p>}
                              {a.actualResult && <p className="prewrap"><strong>Actual:</strong> {a.actualResult}</p>}
                              {a.remarks && <p className="prewrap">{a.remarks}</p>}
                            </td>
                            <td className="text-xs">
                              {a.evidence.length === 0 ? (
                                <span className="text-slate-400">{a.source === "IMPORT" ? "none (unknown)" : "none"}</span>
                              ) : (
                                <ul>
                                  {a.evidence.map((e) => (
                                    <li key={e.id}>
                                      <a className="text-teal-700 hover:underline" href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer">{e.originalName}</a>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Versions (${tc.versions.length})`}>
        <ul className="space-y-2">
          {tc.versions.map((v) => (
            <li key={v.id}>
              <details className="rounded border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <strong>v{v.versionNumber}</strong> · {SOURCE_LABEL[v.source]} · {formatDateTime(v.createdAt)} {v.createdBy && `by ${v.createdBy}`}
                  {v.changeNote && <span className="block text-xs text-slate-500">{v.changeNote.split("\n")[0]}</span>}
                </summary>
                <div className="grid gap-3 border-t border-slate-100 px-3 py-2 text-sm md:grid-cols-2">
                  <div><p className="label">Title</p>{v.title}</div>
                  <div><p className="label">Section / role / env</p>{[v.section, v.role, v.environment].filter(Boolean).join(" · ") || "—"}</div>
                  <div><p className="label">Steps</p><Prewrap text={v.stepsText} /></div>
                  <div><p className="label">Expected</p><Prewrap text={v.expectedResult} /></div>
                  {v.changeNote && <div className="md:col-span-2"><p className="label">Change note</p><Prewrap text={v.changeNote} /></div>}
                  {v.importRow && (
                    <div className="md:col-span-2">
                      <p className="label">Original imported row (provenance)</p>
                      <p className="text-xs text-slate-600">
                        {v.importRow.batch.fileName}
                        {v.importRow.batch.sheetName ? `, sheet “${v.importRow.batch.sheetName}”` : ""}, row {v.importRow.rowNumber} · imported {formatDateTime(v.importRow.batch.createdAt)} by {v.importRow.batch.importedBy}
                      </p>
                      <table className="table-base mt-1 text-xs">
                        <tbody>
                          {Object.entries(v.importRow.raw as Record<string, string | null>).map(([k, val]) => (
                            <tr key={k}>
                              <th className="w-40 normal-case">{k}</th>
                              <td className="prewrap">{val ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
