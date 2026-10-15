import Link from "next/link";
import { Gallery } from "@/components/image-gallery";
import { getPrisma } from "@/server/db";
import { inbox } from "@/server/services/attention-service";
import { EmptyState, OutcomeBadge, OutcomeIcon, PageHeader, Prewrap, PriorityBadge } from "@/components/ui";
import { IconPaperclip } from "@/components/icons";
import { ReviewDecision } from "@/components/review-decision";
import { AskCard } from "@/components/ask-card";
import { formatDateTime } from "@/lib/dates";
import { EXECUTION_METHOD_LABEL, type OutcomeValue, type PriorityValue } from "@/lib/domain";

export const metadata = { title: "Needs you" };

const STEP_TEXT: Record<string, string> = { PASS: "Pass", FAIL: "Fail", BLOCKED: "Blocked", NOT_APPLICABLE: "N/A", NOT_RUN: "Not done" };

const PROPOSAL_LABEL: Record<string, string> = {
  DRAFT_CASES: "Drafted test cases",
  REVIEW_RESULTS: "Results review",
  REPORT_SUMMARY: "Report summary",
  RECIPE: "Runner recipe",
};

/**
 * Everything waiting for a person, across all runs and rounds. Nothing here counts until you
 * decide, and anything can be sent back to the AI to check again after you've acted.
 */
export default async function NeedsYouPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { requests, reviews, proposals } = await inbox(getPrisma(), appId);
  const base = `/apps/${appId}`;
  const total = requests.length + reviews.length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Needs you"
        subtitle={total ? `${total} item${total === 1 ? "" : "s"}, oldest first. The AI keeps working on other cases meanwhile.` : undefined}
        actions={
          reviews.length > 0 && (
            <p className="hidden items-center gap-1 text-xs text-slate-500 sm:flex">
              Decide the top result with <span className="kbd">P</span> <span className="kbd">F</span> <span className="kbd">B</span> <span className="kbd">N</span>
            </p>
          )
        }
      />

      {total === 0 && (
        <EmptyState title="You're all caught up" action={<Link className="btn-primary" href={`${base}/run`}>Run tests</Link>}>
          Questions from the AI, results it couldn&apos;t confirm, and cases it needs a person for show up here. The count in the sidebar tells you when something arrives.
        </EmptyState>
      )}

      {requests.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold">
            Questions and hand-offs <span className="font-normal text-slate-500">({requests.length})</span>
          </h2>
          <div className="space-y-3">
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
                      <Link className="hover:text-ink-900 hover:underline" href={`${base}/run/${it.runId}`}>{it.run.cycle.name}</Link> · {formatDateTime(r.createdAt)}
                      {r.kind === "INPUT" && it.status === "NEEDS_HUMAN" && " · case paused until you answer"}
                    </>
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold">
            Results to confirm <span className="font-normal text-slate-500">({reviews.length})</span>
          </h2>
          <div className="space-y-4">
            {reviews.map((a, i) => {
              const v = a.caseVersion;
              const images = a.evidence.filter((e) => e.mimeType.startsWith("image/"));
              const files = a.evidence.filter((e) => !e.mimeType.startsWith("image/"));
              const recheckId = a.runItems.flatMap((ri) => ri.requests)[0]?.id ?? null;
              return (
                <article key={a.id} className={`rounded-lg border bg-white ${i === 0 ? "border-ink-300" : "border-slate-200"} ${a.isSimulated ? "border-dashed" : ""}`}>
                  <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4">
                    <Link className="case-id hover:underline" href={`${base}/cycles/${a.cycleCase.cycleId}/run/${a.cycleCaseId}`}>{a.cycleCase.testCase.externalId}</Link>
                    <h3 className="min-w-0 flex-1 font-medium">{v.title}</h3>
                    <PriorityBadge priority={v.priority as PriorityValue} />
                  </header>
                  <p className="px-4 pt-0.5 text-xs text-slate-500">
                    {a.cycleCase.cycle.name} · attempt {a.attemptNumber} · {EXECUTION_METHOD_LABEL[a.executionMethod]}
                    {a.agentLabel ? ` · ${a.agentLabel}` : ""} · {formatDateTime(a.createdAt)}
                  </p>

                  <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
                    <div className="space-y-3 text-sm">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="mb-0.5 text-xs text-slate-500">Expected</p>
                          <Prewrap text={v.expectedResult} />
                        </div>
                        <div>
                          <p className="mb-0.5 text-xs text-slate-500">What the AI saw</p>
                          <Prewrap text={a.actualResult} />
                        </div>
                      </div>
                      {a.stepOutcomes.length > 0 && (
                        <ol className="space-y-1 border-t border-slate-100 pt-3">
                          {a.stepOutcomes.map((s) => (
                            <li key={s.id} className="flex items-start gap-2">
                              <span className="mt-[3px]"><OutcomeIcon outcome={s.result as OutcomeValue} size={13} /></span>
                              <span className="sr-only">{STEP_TEXT[s.result]}:</span>
                              <span className="min-w-0">
                                {s.stepText.split("\n")[0]}
                                {!s.required && <span className="text-xs text-slate-500"> (optional)</span>}
                                {s.note && <span className="block text-xs text-slate-500">{s.note}</span>}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {a.partialCoverage && <p className="text-sm text-orange-800">Not covered: {a.partialCoverageNote}</p>}
                    </div>
                    <div>
                      {images.length === 0 && files.length === 0 ? (
                        <p className="text-xs text-slate-500">No screenshots.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                          <Gallery className="contents" images={images.map((e) => ({ id: e.id, caption: e.caption ?? e.originalName }))} maxThumbs={3} thumbClass="w-full" imgClass="h-28" />
                          {files.map((e) => (
                            <a key={e.id} className="flex items-center gap-1 text-sm text-accent-700 hover:underline" href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer">
                              <IconPaperclip size={14} /> {e.originalName}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <footer className="space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm">
                      {a.proposedOutcome ? (
                        <>
                          <span className="text-slate-600">AI suggests</span> <OutcomeBadge outcome={a.proposedOutcome as OutcomeValue} />
                          {a.outcomeReason && <span className="text-slate-600">· {a.outcomeReason}</span>}
                        </>
                      ) : (
                        <span className="text-slate-600">No suggestion from the AI.</span>
                      )}
                      <Link className="ml-auto text-xs text-slate-500 hover:text-ink-900 hover:underline" href={`${base}/cycles/${a.cycleCase.cycleId}/run/${a.cycleCaseId}`}>
                        Edit checks in full
                      </Link>
                    </p>
                    <ReviewDecision
                      attemptId={a.id}
                      appId={appId}
                      proposed={(a.proposedOutcome as OutcomeValue | null) ?? null}
                      proposedReason={a.outcomeReason ?? ""}
                      recheckRequestId={recheckId}
                      keyboard={i === 0}
                    />
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {proposals.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">AI drafts to look at <span className="font-normal text-slate-500">(optional)</span></h2>
          <p className="mb-3 text-sm text-slate-500">Drafts the AI made when you asked. Nothing changes until you accept them.</p>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm">
            {proposals.map((p) => (
              <li key={p.id}>
                <Link className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50" href={`${base}/context/proposals/${p.id}`}>
                  <span className="font-medium text-ink-900">{PROPOSAL_LABEL[p.kind] ?? p.kind}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{p.items.length} to review · {formatDateTime(p.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
