import Link from "next/link";
import { redirect } from "next/navigation";
import { getPrisma } from "@/server/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { CreateApplication } from "@/components/create-application";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ all?: string; new?: string }> }) {
  const { all, new: openNew } = await searchParams;
  const db = getPrisma();
  const apps = await db.application.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { cases: { where: { archived: false } } } },
      cycles: { where: { kind: { not: "SIMULATION" } }, orderBy: { createdAt: "desc" }, take: 1, select: { name: true, createdAt: true } },
    },
  });
  // Most people test one application: skip the list and go straight to it.
  if (apps.length === 1 && !all) redirect(`/apps/${apps[0].id}`);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Applications" subtitle="Each application has its own test cases, environments, results and reports." actions={apps.length > 0 && <CreateApplication defaultOpen={Boolean(openNew)} />} />
      {apps.length === 0 ? (
        <EmptyState title="Add the application you test" action={<CreateApplication primary defaultOpen={Boolean(openNew)} />}>
          For example KFastTrack. Next you import its checklist and tell the AI how to sign in.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {apps.map((a) => (
            <li key={a.id}>
              <Link href={`/apps/${a.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="font-medium text-ink-900">{a.name}</span>
                  {a.description && <span className="ml-2 text-sm text-slate-500">{a.description}</span>}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {a._count.cases} cases · {a.cycles[0] ? `last round ${a.cycles[0].name}, ${formatDateTime(a.cycles[0].createdAt)}` : "no results yet"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
