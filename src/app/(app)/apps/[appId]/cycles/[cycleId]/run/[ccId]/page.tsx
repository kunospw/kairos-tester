import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { Alert, Card, FlagBadge, LifecycleBadge, ModeBadge, OutcomeBadge, PageHeader, Prewrap, PriorityBadge, SimulationBanner } from "@/components/ui";
import { ExecutionPanel, type OpenAttempt } from "@/components/execution-panel";
import { AdoptLatestButton } from "@/components/adopt-latest-button";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { EXECUTION_METHOD_LABEL, type AttemptStatusValue, type ExecutionModeValue, type OutcomeValue, type PriorityValue } from "@/lib/domain";

export const metadata = { title: "Execute test" };

export default async function RunPage({ params }: { params: Promise<{ appId: string; cycleId: string; ccId: string }> }) {
  const { appId, cycleId, ccId } = await params;
  const db = getPrisma();
  const user = await getSession();
  const cc = await db.cycleCase.findFirst({
    where: { id: ccId, cycleId, cycle: { applicationId: appId } },
    include: {
      cycle: { include: { environment: true } },
      testCase: { include: { automation: true } },
      caseVersion: true,
      attempts: {
        orderBy: { attemptNumber: "desc" },
        include: { evidence: { orderBy: { createdAt: "asc" } }, stepOutcomes: { orderBy: { stepIndex: "asc" } }, caseVersion: true },
      },
      findings: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!cc) notFound();
  const latest = await db.testCaseVersion.findFirstOrThrow({ where: { testCaseId: cc.testCaseId }, orderBy: { versionNumber: "desc" } });
  const v = cc.caseVersion;
  const open = cc.attempts.find((a) => a.status !== "COMPLETED") ?? null;
  const completed = cc.attempts.filter((a) => a.status === "COMPLETED");
  const simulation = cc.cycle.kind === "SIMULATION";
  const closed = cc.cycle.status === "CLOSED";

  // Neighbouring cases for quick navigation through the cycle.
  const siblings = await db.cycleCase.findMany({ where: { cycleId }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const idx = siblings.findIndex((s) => s.id === cc.id);
  const prev = siblings[idx - 1]?.id;
  const next = siblings[idx + 1]?.id;
  const base = `/apps/${appId}/cycles/${cycleId}`;

  const openAttempt: OpenAttempt | null = open
    ? {
        id: open.id,
        attemptNumber: open.attemptNumber,
        status: open.status as AttemptStatusValue,
        outcome: open.outcome as OutcomeValue | null,
        outcomeReason: open.outcomeReason ?? "",
        actualResult: open.actualResult ?? "",
        remarks: open.remarks ?? "",
        partialCoverage: open.partialCoverage,
        partialCoverageNote: open.partialCoverageNote ?? "",
        tester: open.tester ?? user?.displayName ?? "",
        executionMethod: open.executionMethod === "HYBRID" ? "HYBRID" : "MANUAL",
        isSimulated: open.isSimulated,
        startedAt: open.startedAt?.toISOString() ?? null,
        steps: open.stepOutcomes.map((s) => ({ stepIndex: s.stepIndex, text: s.stepText, required: s.required, result: s.result, note: s.note ?? "" })),
        evidence: open.evidence.map((e) => ({ id: e.id, name: e.originalName, mimeType: e.mimeType, sizeBytes: e.sizeBytes, caption: e.caption })),
      }
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${cc.testCase.externalId} · ${v.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>Round <strong>{cc.cycle.name}</strong></span>
            <span>· Build {cc.cycle.buildLabel ?? "not recorded"}</span>
            <span>· Instructions v{v.versionNumber}</span>
            <PriorityBadge priority={v.priority as PriorityValue} />
            <ModeBadge mode={v.executionMode as ExecutionModeValue} />
          </span>
        }
        actions={
          <>
            <Link className="btn-secondary" href={base}>← Round</Link>
            {prev && <Link className="btn-secondary" href={`${base}/run/${prev}`}>‹ Previous</Link>}
            {next && <Link className="btn-secondary" href={`${base}/run/${next}`}>Next ›</Link>}
          </>
        }
      />
      {simulation && <SimulationBanner />}
      {closed && <Alert kind="info" title="This round is closed.">Results are read-only. Reopen the round to record more attempts.</Alert>}
      {latest.versionNumber !== v.versionNumber && (
        <Alert kind="warning" title={`A newer version of this case exists (v${latest.versionNumber}).`}>
          This round uses v{v.versionNumber}. Earlier attempts keep the instructions they used.
          {!open && !closed && <AdoptLatestButton ccId={cc.id} latest={latest.versionNumber} />}
        </Alert>
      )}
      {cc.findings.length > 0 && (
        <div className="space-y-1">
          {cc.findings.map((f) => (
            <div key={f.id} className="rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-950">
              <FlagBadge type={f.type} /> <span className="ml-1">{f.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Instructions">
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-3">
                <div><dt className="label">Sign in as</dt><dd>{v.role ?? "—"}</dd></div>
                <div><dt className="label">Environment</dt><dd>{v.environment ?? "—"}</dd></div>
              </dl>
              <dl className="space-y-3">
                {v.dependsOn && <div><dt className="label">Depends on</dt><dd>{v.dependsOn}</dd></div>}
                <div><dt className="label">Preconditions</dt><dd><Prewrap text={v.preconditions} empty="None stated" /></dd></div>
                <div><dt className="label">Steps</dt><dd><Prewrap text={v.stepsText} /></dd></div>
                <div><dt className="label">Expected result</dt><dd className="rounded bg-accent-50 p-2"><Prewrap text={v.expectedResult} /></dd></div>
                {v.testData && <div><dt className="label">Test data</dt><dd><Prewrap text={v.testData} /></dd></div>}
              </dl>
            </div>
          </Card>
          <Card title="Target application">
            {cc.cycle.environment?.targetUrl ? (
              <p className="text-sm">
                Open the application separately and perform the steps:{" "}
                <a className="font-medium text-accent-700 underline" href={cc.cycle.environment.targetUrl} target="_blank" rel="noreferrer noopener">
                  {cc.cycle.environment.name}: {cc.cycle.environment.targetUrl} ↗
                </a>
              </p>
            ) : (
              <p className="text-sm text-slate-500">No target URL recorded for this round&apos;s environment. Open the application under test separately.</p>
            )}
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Want the AI to test it? <Link className="text-accent-700 underline" href={`/apps/${appId}/run`}>Start a run</Link> and choose this round; it picks up the cases not tested yet.
            </p>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-3">
          <ExecutionPanel
            appId={appId}
            ccId={cc.id}
            attempt={openAttempt}
            hasHistory={cc.attempts.length > 0}
            closed={closed}
            hybrid={v.executionMode === "HYBRID" || open?.executionMethod === "AI_DRIVEN"}
            defaultTester={user?.displayName ?? ""}
          />

          <Card title={`Attempt history (${completed.length} completed)`}>
            {completed.length === 0 ? (
              <p className="text-sm text-slate-500">
                No completed attempts in this round.{cc.importNotes ? ` Imported note: ${cc.importNotes}` : ""}
              </p>
            ) : (
              <ol className="space-y-3">
                {completed.map((a) => (
                  <li key={a.id} className={`rounded border p-3 text-sm ${a.isSimulated ? "border-dashed border-slate-400" : "border-slate-200"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>Attempt {a.attemptNumber}</strong>
                      {a.outcome && <OutcomeBadge outcome={a.outcome as OutcomeValue} />}
                      {a.partialCoverage && <FlagBadge type="INCOMPLETE_TESTING" />}
                      <span className="text-xs text-slate-500">
                        v{a.caseVersion.versionNumber} · {a.tester ?? "tester unknown"} · {a.completedAt ? formatDateTime(a.completedAt) : formatDateOnly(a.executedOn)} ·{" "}
                        {EXECUTION_METHOD_LABEL[a.executionMethod]} · {a.source === "IMPORT" ? "imported historical record (build unknown)" : a.source === "SIMULATION" ? "SIMULATED" : `build ${a.buildLabel ?? "not recorded"}`}
                        {a.agentLabel ? ` · run by ${a.agentLabel}` : ""}
                      </span>
                    </div>
                    {a.outcomeReason && <p className="mt-1"><strong>Reason:</strong> {a.outcomeReason}</p>}
                    {a.actualResult && <p className="prewrap mt-1"><strong>Actual:</strong> {a.actualResult}</p>}
                    {a.remarks && <p className="prewrap mt-1 text-slate-700">{a.remarks}</p>}
                    {a.partialCoverageNote && <p className="mt-1 text-orange-900"><strong>Not covered:</strong> {a.partialCoverageNote}</p>}
                    {a.humanCheckpointBy && <p className="mt-1 text-xs text-slate-600">Human checkpoint confirmed by {a.humanCheckpointBy}</p>}
                    {a.stepOutcomes.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-600">Step outcomes</summary>
                        <ol className="mt-1 space-y-0.5 text-xs">
                          {a.stepOutcomes.map((s) => (
                            <li key={s.id}>
                              {s.stepIndex + 1}. [{s.result.replace("_", " ").toLowerCase()}] {s.stepText.split("\n")[0]} {s.note && <em className="text-slate-500">: {s.note}</em>}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    {a.evidence.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-2 text-xs">
                        {a.evidence.map((e) => (
                          <li key={e.id}>
                            <a className="text-accent-700 underline" href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer">📎 {e.originalName}</a>
                            {e.caption && <span className="text-slate-500"> ({e.caption})</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.source === "IMPORT" && a.evidence.length === 0 && <p className="mt-1 text-xs text-slate-500">Evidence, step outcomes and execution method: unknown (imported).</p>}
                  </li>
                ))}
              </ol>
            )}
            {open && <p className="mt-2 text-xs text-slate-500">Open attempt #{open.attemptNumber}: <LifecycleBadge status={open.status as AttemptStatusValue} /></p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
