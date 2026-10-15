import Link from "next/link";
import { getPrisma } from "@/server/db";
import { aiConfig } from "@/server/ai/ollama";
import { Alert, Card, PageHeader } from "@/components/ui";
import { ContextManager } from "@/components/context-manager";
import { AiDraftCases } from "@/components/ai-draft-cases";
import { AiReviewResults } from "@/components/ai-review-results";
import { formatDateTime } from "@/lib/dates";
import { OUTCOME_LABEL, type OutcomeValue } from "@/lib/domain";
import { loadCycleResults } from "@/server/services/results";

export const metadata = { title: "Context & AI" };

const KIND_LABEL: Record<string, string> = {
  DRAFT_CASES: "Drafted test cases",
  REVIEW_RESULTS: "Results review",
  REPORT_SUMMARY: "Report summary",
};

export default async function ContextPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ cycle?: string }> }) {
  const { appId } = await params;
  const { cycle: cycleParam } = await searchParams;
  const db = getPrisma();
  const [entries, sources, proposals, cycles] = await Promise.all([
    db.contextEntry.findMany({ where: { applicationId: appId }, orderBy: [{ category: "asc" }, { createdAt: "asc" }], include: { sourceReference: true } }),
    db.sourceReference.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "desc" } }),
    db.aiProposal.findMany({
      where: { applicationId: appId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { items: { select: { status: true } } },
    }),
    db.testCycle.findMany({ where: { applicationId: appId, kind: { not: "SIMULATION" } }, orderBy: { createdAt: "desc" } }),
  ]);
  const cfg = aiConfig();
  const reviewCycle = cycles.find((c) => c.id === cycleParam) ?? cycles[0] ?? null;
  const reviewRows = reviewCycle
    ? (await loadCycleResults(db, reviewCycle.id)).rows.map((r) => ({
        cycleCaseId: r.cycleCaseId,
        externalId: r.externalId,
        title: r.version.title,
        section: r.section,
        outcome: OUTCOME_LABEL[r.outcome as OutcomeValue],
        hasNotes: Boolean(r.latestCompleted?.remarks || r.latestCompleted?.actualResult || r.latestCompleted?.outcomeReason),
        flagged: r.openFindings.length > 0,
      }))
    : [];

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: `/apps/${appId}/settings`, label: "Setup" }}
        title="Knowledge & AI drafting"
        subtitle="The AI drafts cases and reviews results from what it knows about this application. Everything it writes is a draft until you accept it."
      />
      {!cfg.keyConfigured && (
        <Alert kind="info" title="AI is not configured">
          Set OLLAMA_API_KEY in .env to enable AI actions. Everything else works without AI. <Link className="underline" href="/settings">Settings</Link>
        </Alert>
      )}

      <div id="draft" className="scroll-mt-6">
      <div className="grid gap-5 xl:grid-cols-2">
        <AiDraftCases
          appId={appId}
          enabled={cfg.keyConfigured}
          entries={entries.map((e) => ({ id: e.id, title: e.title, status: e.status, category: e.category }))}
        />
        <AiReviewResults
          appId={appId}
          enabled={cfg.keyConfigured}
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          cycleId={reviewCycle?.id ?? null}
          rows={reviewRows}
        />
      </div>

      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">What the AI knows</h2>
        <p className="mb-3 text-sm text-slate-500">Roles, workflows and rules. Reviewed entries are used when drafting; unreviewed ones are marked as such.</p>
      <ContextManager
        appId={appId}
        entries={entries.map((e) => ({
          id: e.id,
          category: e.category,
          title: e.title,
          body: e.body,
          status: e.status,
          sourceTitle: e.sourceReference?.title ?? null,
          sourceExcerpt: e.sourceExcerpt,
          reviewedBy: e.reviewedBy,
          reviewedAt: e.reviewedAt ? formatDateTime(e.reviewedAt) : null,
        }))}
        sources={sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title, location: s.location, notes: s.notes }))}
      />

      </div>

      <Card title="Earlier AI drafts">
        {proposals.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing drafted yet.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr><th>When</th><th>Type</th><th>Model</th><th>Items</th><th>Pending</th><th>Requested by</th></tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap"><Link className="text-accent-700 hover:underline" href={`/apps/${appId}/context/proposals/${p.id}`}>{formatDateTime(p.createdAt)}</Link></td>
                  <td>{KIND_LABEL[p.kind]}</td>
                  <td className="text-xs">{p.model}</td>
                  <td>{p.items.length}</td>
                  <td>{p.items.filter((i) => i.status === "PENDING").length}</td>
                  <td className="text-xs">{p.requestedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
