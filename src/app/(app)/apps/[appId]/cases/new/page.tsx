import { getPrisma } from "@/server/db";
import { CaseForm, emptyCase } from "@/components/case-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "New test case" };

export default async function NewCasePage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const sections = await getPrisma().testCaseVersion.findMany({
    where: { testCase: { applicationId: appId }, section: { not: null } },
    distinct: ["section"],
    select: { section: true },
  });
  return (
    <>
      <PageHeader title="New test case" subtitle="Creates version 1 of a new case. It is not added to any round until you create or update a round." />
      <Card>
        <CaseForm appId={appId} mode="create" initial={emptyCase} sections={sections.map((s) => s.section!)} />
      </Card>
    </>
  );
}
