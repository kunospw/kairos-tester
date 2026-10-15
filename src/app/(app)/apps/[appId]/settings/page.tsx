import { getPrisma } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { EnvironmentManager } from "@/components/environment-manager";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "App settings" };

export default async function AppSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const db = getPrisma();
  const [app, environments, batches, bindings] = await Promise.all([
    db.application.findUniqueOrThrow({ where: { id: appId } }),
    db.environment.findMany({ where: { applicationId: appId }, orderBy: { name: "asc" }, include: { _count: { select: { cycles: true } } } }),
    db.importBatch.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "desc" }, include: { cycle: true } }),
    db.automationBinding.findMany({ where: { testCase: { applicationId: appId } }, include: { testCase: true } }),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="Application settings" subtitle={app.description ?? undefined} />
      <EnvironmentManager
        appId={appId}
        environments={environments.map((e) => ({ id: e.id, name: e.name, type: e.type, targetUrl: e.targetUrl, notes: e.notes, cycles: e._count.cycles }))}
      />
      <Card title="Automation">
        <p className="text-sm">
          Runner: <strong>Not connected</strong>. {bindings.length} case(s) have an automation reference stored ({bindings.filter((b) => b.reviewedBy).length} reviewed). Automated
          execution is disabled until a local runner is connected. See <code>docs/runner-interface.md</code> for the planned interface.
        </p>
        {bindings.length > 0 && (
          <ul className="mt-2 text-xs text-slate-600">
            {bindings.map((b) => (
              <li key={b.id}>{b.testCase.externalId}: {b.runnerType}{b.externalTestId ? ` · ${b.externalTestId}` : ""}{b.reviewedBy ? " · reviewed" : " · not reviewed"}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Import history (provenance)">
        {batches.length === 0 ? (
          <p className="text-sm text-slate-500">No imports yet.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr><th>When</th><th>File</th><th>Sheet</th><th>Into cycle</th><th>By</th><th>Result</th></tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const s = b.stats as Record<string, number>;
                return (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(b.createdAt)}</td>
                    <td className="text-xs">{b.fileName}<div className="text-slate-400">sha256 {b.fileSha256.slice(0, 12)}…</div></td>
                    <td className="text-xs">{b.sheetName ?? "—"}</td>
                    <td className="text-xs">{b.cycle.name}</td>
                    <td className="text-xs">{b.importedBy}</td>
                    <td className="text-xs">
                      {s.casesCreated ?? 0} created · {s.casesUpdated ?? 0} updated · {s.casesSkipped ?? 0} skipped · {s.errorRows ?? 0} errors · {s.attemptsCreated ?? 0} attempts
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
