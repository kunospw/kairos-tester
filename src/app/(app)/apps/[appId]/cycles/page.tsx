import Link from "next/link";
import { getPrisma } from "@/server/db";
import { loadCycleResults } from "@/server/services/results";
import { EmptyState, PageHeader } from "@/components/ui";
import { CreateCycle } from "@/components/create-cycle";
import { formatPercent } from "@/lib/metrics";
import { formatDateTime } from "@/lib/dates";
import { CYCLE_KIND_LABEL } from "@/lib/domain";

export const metadata = { title: "Cycles" };

export default async function CyclesPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const db = getPrisma();
  const [cycles, environments, cases] = await Promise.all([
    db.testCycle.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "desc" }, include: { environment: true } }),
    db.environment.findMany({ where: { applicationId: appId }, orderBy: { name: "asc" } }),
    db.testCase.findMany({
      where: { applicationId: appId, archived: false },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { section: true } } },
    }),
  ]);
  const sectionCounts = new Map<string, number>();
  for (const c of cases) {
    const s = c.versions[0]?.section ?? "(no section)";
    sectionCounts.set(s, (sectionCounts.get(s) ?? 0) + 1);
  }
  const summaries = await Promise.all(cycles.map((c) => loadCycleResults(db, c.id)));

  const create = (
    <CreateCycle
      appId={appId}
      environments={environments.map((e) => ({ id: e.id, name: e.name }))}
      sections={[...sectionCounts.entries()].map(([name, count]) => ({ name, count }))}
      totalCases={cases.length}
    />
  );

  return (
    <>
      <PageHeader title="Test cycles" subtitle="A cycle is one round of testing against a specific environment and build. New cycles start with every case Not run." actions={create} />
      {cycles.length === 0 ? (
        <EmptyState title="No cycles yet" action={create}>
          {cases.length ? "Create a cycle to start recording results." : "Import or create test cases first."}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Type</th>
                <th>Environment</th>
                <th>Build</th>
                <th className="text-right">Cases</th>
                <th className="text-right">Pass</th>
                <th className="text-right">Fail</th>
                <th className="text-right">Blocked</th>
                <th className="text-right">Not run</th>
                <th>Coverage</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c, i) => {
                const m = summaries[i].metrics;
                return (
                  <tr key={c.id} className={c.kind === "SIMULATION" ? "bg-purple-50/50" : ""}>
                    <td className="font-medium">
                      <Link className="text-teal-700 hover:underline" href={`/apps/${appId}/cycles/${c.id}`}>{c.name}</Link>
                    </td>
                    <td className="text-xs">{CYCLE_KIND_LABEL[c.kind]}</td>
                    <td className="text-xs">{c.environment?.name ?? "not recorded"}</td>
                    <td className="text-xs">{c.buildLabel ?? "not recorded"}</td>
                    <td className="text-right">{m.total}</td>
                    <td className="text-right">{m.PASS}</td>
                    <td className="text-right">{m.FAIL}</td>
                    <td className="text-right">{m.BLOCKED}</td>
                    <td className="text-right">{m.NOT_RUN}</td>
                    <td className="whitespace-nowrap text-xs">{formatPercent(m.coverage, "—")}</td>
                    <td className="text-xs">{c.status === "OPEN" ? "Open" : "Closed"}</td>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(c.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
