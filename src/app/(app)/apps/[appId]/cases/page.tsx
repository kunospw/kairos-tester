import Link from "next/link";
import { getPrisma } from "@/server/db";
import { loadCycleResults } from "@/server/services/results";
import { EmptyState, PageHeader } from "@/components/ui";
import { CyclePicker } from "@/components/cycle-picker";
import { CaseTable, type CaseListRow } from "@/components/case-table";
import type { ExecutionModeValue, OutcomeValue, PriorityValue } from "@/lib/domain";

export const metadata = { title: "Test cases" };

export default async function CasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { appId } = await params;
  const { cycle: cycleParam } = await searchParams;
  const db = getPrisma();
  const [cases, cycles] = await Promise.all([
    db.testCase.findMany({
      where: { applicationId: appId },
      orderBy: { createdAt: "asc" },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        _count: { select: { versions: true, findings: { where: { status: "OPEN" } } } },
        automation: true,
      },
    }),
    db.testCycle.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "desc" } }),
  ]);

  const base = `/apps/${appId}`;
  const actions = (
    <>
      <a className="btn-secondary" href="/api/import/template">Download CSV template</a>
      <Link className="btn-secondary" href={`${base}/cases/import`}>Import XLSX / CSV</Link>
      <Link className="btn-primary" href={`${base}/cases/new`}>+ New case</Link>
    </>
  );

  if (cases.length === 0) {
    return (
      <>
        <PageHeader title="Test cases" actions={actions} />
        <EmptyState title="No test cases yet" action={<Link className="btn-accent" href={`${base}/cases/import`}>Import a checklist</Link>}>
          Import an XLSX/CSV checklist, create cases by hand, or draft them with AI from the Context &amp; AI tab.
        </EmptyState>
      </>
    );
  }

  const realCycles = cycles.filter((c) => c.kind !== "SIMULATION");
  const selected = cycles.find((c) => c.id === cycleParam) ?? realCycles[0] ?? cycles[0] ?? null;
  const results = selected ? await loadCycleResults(db, selected.id) : null;
  const byCase = new Map(results?.rows.map((r) => [r.testCaseId, r]) ?? []);

  const rows: CaseListRow[] = cases.map((c) => {
    const v = c.versions[0];
    const r = byCase.get(c.id);
    return {
      id: c.id,
      externalId: c.externalId,
      title: v.title,
      section: v.section,
      role: v.role,
      environment: v.environment,
      priority: v.priority as PriorityValue,
      mode: v.executionMode as ExecutionModeValue,
      categories: v.categories,
      versionNumber: v.versionNumber,
      origin: c.origin,
      inCycle: Boolean(r),
      outcome: (r?.outcome ?? null) as OutcomeValue | null,
      lifecycle: r?.lifecycle ?? null,
      cycleCaseId: r?.cycleCaseId ?? null,
      openFlags: c._count.findings,
      automation: Boolean(c.automation),
    };
  });

  return (
    <>
      <PageHeader
        title="Test cases"
        subtitle={`${cases.length} cases. Results shown for the selected cycle.`}
        actions={actions}
      />
      <div className="mb-3">{cycles.length > 0 && <CyclePicker cycles={cycles} value={selected?.id ?? null} label="Results from" />}</div>
      <CaseTable rows={rows} base={base} cycleId={selected?.id ?? null} simulation={results?.simulation ?? false} />
    </>
  );
}
