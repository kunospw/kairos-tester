import { getPrisma } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/import-wizard";

export const metadata = { title: "Import cases" };

export default async function ImportPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const db = getPrisma();
  const [cycles, environments, caseCount] = await Promise.all([
    db.testCycle.findMany({
      where: { applicationId: appId, kind: { not: "SIMULATION" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, kind: true },
    }),
    db.environment.findMany({ where: { applicationId: appId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.testCase.count({ where: { applicationId: appId } }),
  ]);
  return (
    <>
      <PageHeader
        title="Import test cases and historical results"
        subtitle="XLSX or CSV. Nothing is saved until you confirm the preview. Existing cases and results are never silently overwritten."
        actions={<a className="btn-secondary" href="/api/import/template">Download CSV template</a>}
      />
      <ImportWizard appId={appId} cycles={cycles} environments={environments} existingCases={caseCount} />
    </>
  );
}
