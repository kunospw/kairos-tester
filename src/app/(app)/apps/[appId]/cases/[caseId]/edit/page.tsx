import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";
import { CaseForm } from "@/components/case-form";
import { Card, PageHeader } from "@/components/ui";
import type { ExecutionModeValue, PriorityValue } from "@/lib/domain";

export const metadata = { title: "Edit test case" };

export default async function EditCasePage({ params }: { params: Promise<{ appId: string; caseId: string }> }) {
  const { appId, caseId } = await params;
  const db = getPrisma();
  const tc = await db.testCase.findFirst({
    where: { id: caseId, applicationId: appId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!tc) notFound();
  const v = tc.versions[0];
  const sections = await db.testCaseVersion.findMany({
    where: { testCase: { applicationId: appId }, section: { not: null } },
    distinct: ["section"],
    select: { section: true },
  });
  return (
    <>
      <PageHeader title={`Edit ${tc.externalId}`} subtitle={`Currently version ${v.versionNumber}`} />
      <Card>
        <CaseForm
          appId={appId}
          mode="edit"
          caseId={tc.id}
          versionNumber={v.versionNumber}
          sections={sections.map((s) => s.section!)}
          initial={{
            externalId: tc.externalId,
            title: v.title,
            section: v.section ?? "",
            role: v.role ?? "",
            environment: v.environment ?? "",
            preconditions: v.preconditions ?? "",
            stepsText: v.stepsText ?? "",
            steps: (v.steps as { text: string; required: boolean }[]) ?? [],
            expectedResult: v.expectedResult ?? "",
            testData: v.testData ?? "",
            priority: v.priority as PriorityValue,
            executionMode: v.executionMode as ExecutionModeValue,
            categories: v.categories,
            dependsOn: v.dependsOn ?? "",
          }}
        />
      </Card>
    </>
  );
}
