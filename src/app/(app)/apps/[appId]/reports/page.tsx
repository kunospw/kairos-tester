import Link from "next/link";
import { getPrisma } from "@/server/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { CreateReport } from "@/components/create-report";
import { formatDateTime } from "@/lib/dates";
import { formatPercent } from "@/lib/metrics";
import type { ReportData } from "@/server/services/report-service";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ cycle?: string }> }) {
  const { appId } = await params;
  const { cycle } = await searchParams;
  const db = getPrisma();
  const [cycles, reports] = await Promise.all([
    db.testCycle.findMany({ where: { applicationId: appId, kind: { not: "SIMULATION" } }, orderBy: { createdAt: "desc" } }),
    db.reportSnapshot.findMany({ where: { cycle: { applicationId: appId } }, orderBy: { createdAt: "desc" }, include: { cycle: true } }),
  ]);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="A report is a saved snapshot of a cycle's results. Later retests do not change an existing snapshot; create a new one instead."
        actions={cycles.length > 0 && <CreateReport appId={appId} cycles={cycles.map((c) => ({ id: c.id, name: c.name, scope: c.scope, excludedScope: c.excludedScope }))} defaultCycleId={cycle} />}
      />
      {reports.length === 0 ? (
        <EmptyState title="No reports yet">
          {cycles.length ? "Create a report snapshot from a cycle." : "Create or import a cycle first. Simulation cycles cannot be reported."}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Report</th><th>Cycle</th><th>Snapshot taken</th><th className="text-right">Cases</th><th>Coverage</th><th>Pass rate</th><th>AI summary</th></tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const d = r.data as unknown as ReportData;
                return (
                  <tr key={r.id}>
                    <td className="font-medium"><Link className="text-teal-700 hover:underline" href={`/apps/${appId}/reports/${r.id}`}>{r.title}</Link></td>
                    <td className="text-xs">{r.cycle.name}</td>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)} by {r.createdBy}</td>
                    <td className="text-right">{d.metrics.total}</td>
                    <td className="text-xs">{formatPercent(d.metrics.coverage, "—")}</td>
                    <td className="text-xs">{formatPercent(d.metrics.passRate, "No completed tests")}</td>
                    <td className="text-xs">{r.aiSummary ? (r.aiSummaryReviewed ? "Human-reviewed" : "Draft") : "None"}</td>
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
