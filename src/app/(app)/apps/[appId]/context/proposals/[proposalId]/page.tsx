import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";
import { Alert, PageHeader } from "@/components/ui";
import { ProposalItems, type ItemView } from "@/components/proposal-items";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "AI proposal" };

const KIND_LABEL: Record<string, string> = {
  DRAFT_CASES: "Drafted test cases",
  REVIEW_RESULTS: "Results review findings",
  REPORT_SUMMARY: "Report summary draft",
  RECIPE: "Recipe draft",
};

export default async function ProposalPage({ params }: { params: Promise<{ appId: string; proposalId: string }> }) {
  const { appId, proposalId } = await params;
  const db = getPrisma();
  const proposal = await db.aiProposal.findFirst({
    where: { id: proposalId, applicationId: appId },
    include: { items: { orderBy: { index: "asc" }, include: { version: { include: { testCase: true } }, finding: true } } },
  });
  if (!proposal) notFound();
  const cases =
    proposal.kind === "DRAFT_CASES"
      ? await db.testCase.findMany({ where: { applicationId: appId }, select: { id: true, externalId: true }, orderBy: { externalId: "asc" } })
      : [];
  const submitted = proposal.submittedContext as {
    summary?: string;
    items?: string[];
    references?: Record<string, string>;
    droppedFindingsForUnknownCases?: string[];
  };

  const items: ItemView[] = proposal.items.map((i) => ({
    id: i.id,
    index: i.index,
    status: i.status,
    payload: i.payload as Record<string, unknown>,
    decidedBy: i.decidedBy,
    decidedAt: i.decidedAt ? formatDateTime(i.decidedAt) : null,
    decisionNote: i.decisionNote,
    resultingCase: i.version ? { id: i.version.testCaseId, externalId: i.version.testCase.externalId, versionNumber: i.version.versionNumber } : null,
    resultingFinding: Boolean(i.finding),
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={KIND_LABEL[proposal.kind]}
        subtitle={`Generated ${formatDateTime(proposal.createdAt)} by ${proposal.model} for ${proposal.requestedBy}${proposal.durationMs ? ` in ${(proposal.durationMs / 1000).toFixed(1)} s` : ""}`}
        actions={
          <>
            <Link className="btn-secondary" href={`/apps/${appId}/context`}>← Context &amp; AI</Link>
            {proposal.reportId && <Link className="btn-secondary" href={`/apps/${appId}/reports/${proposal.reportId}`}>Open report</Link>}
          </>
        }
      />
      <Alert kind="warning" title="AI proposals are drafts, not facts.">
        Check every item against the source material. AI never decides pass/fail. Accepting creates or versions a case, records a review flag, fills the report summary, or activates a runner recipe,
        and only for the item you accept.
      </Alert>
      <details className="card px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium">What was sent</summary>
        <p className="mt-1">{submitted.summary}</p>
        <ul className="list-disc pl-5 text-xs">{submitted.items?.map((x, n) => <li key={n}>{x}</li>)}</ul>
        {submitted.references && (
          <p className="mt-1 text-xs">References: {Object.entries(submitted.references).map(([k, v]) => `${k} = ${v}`).join("; ")}</p>
        )}
        {submitted.droppedFindingsForUnknownCases?.length ? (
          <p className="mt-1 text-xs text-amber-800">Discarded findings for case IDs that were not submitted: {submitted.droppedFindingsForUnknownCases.join(", ")}</p>
        ) : null}
      </details>
      {items.length === 0 ? (
        <Alert kind="info">The AI returned no items (for a review, that means no findings).</Alert>
      ) : (
        <ProposalItems appId={appId} kind={proposal.kind} items={items} cases={cases} />
      )}
    </div>
  );
}
