import Link from "next/link";
import { getPrisma } from "@/server/db";
import { inbox } from "@/server/services/attention-service";
import { EmptyState, OutcomeBadge, PageHeader, Prewrap, PriorityBadge } from "@/components/ui";
import { ReviewDecision } from "@/components/review-decision";
import { AskCard } from "@/components/ask-card";
import { formatDateTime } from "@/lib/dates";
import { ATTEMPT_SOURCE_LABEL, EXECUTION_METHOD_LABEL, type OutcomeValue, type PriorityValue } from "@/lib/domain";

export const metadata = { title: "Needs you" };

const STEP_ICON: Record<string, string> = { PASS: "✓", FAIL: "✕", BLOCKED: "⊘", NOT_APPLICABLE: "–", NOT_RUN: "○" };

const PROPOSAL_LABEL: Record<string, string> = {
  DRAFT_CASES: "Drafted test cases",
  REVIEW_RESULTS: "Results review",
  REPORT_SUMMARY: "Report summary",
  RECIPE: "Runner recipe",
};

/**
 * Everything waiting for a person, across all runs and cycles: questions from the AI,
 * results to confirm, and (optional) AI suggestions. Nothing here counts until you decide.
 */
export default async function NeedsYouPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { requests, reviews, proposals } = await inbox(getPrisma(), appId);
  const base = `/apps/${appId}`;
  const total = requests.length + reviews.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Needs you (${total})`}
        subtitle="Everything the AI couldn't settle by itself, from every run. Answer here or on the run page; either way it disappears from both."
      />

      {total === 0 && proposals.length === 0 && (
        <EmptyState title="You're all caught up" action={<Link className="btn-accent" href={`${base}/run`}>Run tests</Link>}>
          Questions from the AI, results to confirm and AI suggestions show up here.
        </EmptyState>
      )}

      {requests.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-navy-900">The AI is asking ({requests.length})</h2>
          {requests.map((r) => {
            const it = r.runItem;
            return (
              <AskCard
                key={r.id}
                appId={appId}
                req={{ id: r.id, kind: r.kind, question: r.question, detail: r.detail }}
                manualHref={`${base}/cycles/${it.cycleCase.cycleId}/run/${it.cycleCaseId}`}
                context={
                  <>
                    <Link className="text-teal-700 hover:underline" href={`${base}/run/${it.runId}`}>{it.run.cycle.name}</Link> · {formatDateTime(r.createdAt)}
                    {r.kind === "INPUT" && it.status === "NEEDS_HUMAN" && " · paused: answering re-runs this case"}
                  </>
                }
              />
            );
          })}
        </section>
      )}

      {reviews.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-navy-900">Confirm results ({reviews.length})</h2>
          {reviews.map((a) => {
            const v = a.caseVersion;
            const images = a.evidence.filter((e) => e.mimeType.startsWith("image/"));
            const others = a.evidence.filter((e) => !e.mimeType.startsWith("image/"));
            const runHref = `${base}/cycles/${a.cycleCase.cycleId}/run/${a.cycleCaseId}`;
            return (
              <article key={a.id} className={`card overflow-hidden ${a.isSimulated ? "border-dashed border-purple-400" : ""}`}>
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-navy-900">{a.cycleCase.testCase.externalId}</span>
                    <span>{v.title}</span>
                    <PriorityBadge priority={v.priority as PriorityValue} />
                  </div>
                  <div className="text-xs text-slate-600">
                    {a.cycleCase.cycle.name} · attempt {a.attemptNumber} · {EXECUTION_METHOD_LABEL[a.executionMethod]} · {ATTEMPT_SOURCE_LABEL[a.source]}
                    {a.agentLabel ? ` · ${a.agentLabel}` : ""} · {formatDateTime(a.createdAt)}
                  </div>
                </header>
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <section className="space-y-3 text-sm">
                    <div>
                      <p className="label">Expected result (case v{v.versionNumber})</p>
                      <div className="rounded bg-teal-50 p-2"><Prewrap text={v.expectedResult} /></div>
                    </div>
                    <div>
                      <p className="label">What was observed</p>
                      <div className="rounded bg-slate-50 p-2"><Prewrap text={a.actualResult} /></div>
                    </div>
                    {a.stepOutcomes.length > 0 && (
                      <div>
                        <p className="label">Checks</p>
                        <ol className="space-y-1">
                          {a.stepOutcomes.map((s) => (
                            <li key={s.id} className="flex gap-2">
                              <span className="w-14 shrink-0 text-xs font-semibold" aria-label={s.result}>{STEP_ICON[s.result]} {s.result === "NOT_RUN" ? "not done" : s.result.toLowerCase().replace("_", " ")}</span>
                              <span>
                                {s.stepText.split("\n")[0]}
                                {!s.required && <span className="text-xs text-slate-500"> (optional)</span>}
                                {s.note && <span className="block text-xs text-slate-600">{s.note}</span>}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {a.partialCoverage && <p className="rounded bg-orange-50 p-2 text-orange-900"><strong>Not covered:</strong> {a.partialCoverageNote}</p>}
                    {a.remarks && <p className="text-xs text-slate-500">{a.remarks}</p>}
                  </section>
                  <section className="space-y-2">
                    <p className="label">Evidence ({a.evidence.length})</p>
                    {images.length === 0 && others.length === 0 && <p className="text-sm text-slate-500">No evidence attached.</p>}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {images.map((e) => (
                        <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-slate-200 hover:border-teal-500">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/evidence/${e.id}`} alt={e.caption ?? e.originalName} className="h-40 w-full object-cover object-top" loading="lazy" />
                          <span className="block truncate px-2 py-1 text-xs text-slate-600">{e.caption ?? e.originalName}</span>
                        </a>
                      ))}
                    </div>
                    {others.map((e) => (
                      <a key={e.id} className="block text-sm text-teal-700 underline" href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer">📎 {e.originalName}</a>
                    ))}
                  </section>
                </div>
                <footer className="border-t border-slate-200 px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    {a.proposedOutcome ? (
                      <>
                        <span className="text-slate-600">AI suggests:</span> <OutcomeBadge outcome={a.proposedOutcome as OutcomeValue} />
                        {a.outcomeReason && <span className="text-slate-600">· {a.outcomeReason}</span>}
                      </>
                    ) : (
                      <span className="text-slate-600">No suggested result.</span>
                    )}
                    <Link className="ml-auto text-xs text-teal-700 underline" href={runHref}>Open full attempt to edit checks</Link>
                  </div>
                  <ReviewDecision attemptId={a.id} proposed={(a.proposedOutcome as OutcomeValue | null) ?? null} proposedReason={a.outcomeReason ?? ""} />
                </footer>
              </article>
            );
          })}
        </section>
      )}

      {proposals.length > 0 && (
        <section className="card p-4">
          <h2 className="text-lg font-semibold text-navy-900">AI suggestions to look at (optional)</h2>
          <p className="mb-2 text-sm text-slate-600">Drafts the AI made at your request. Nothing changes until you accept them.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link className="font-medium text-teal-700 hover:underline" href={`${base}/context/proposals/${p.id}`}>{PROPOSAL_LABEL[p.kind] ?? p.kind}</Link>
                <span className="text-xs text-slate-500">{p.items.length} pending · {formatDateTime(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
