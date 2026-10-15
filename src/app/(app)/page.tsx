import Link from "next/link";
import { getPrisma } from "@/server/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { CreateApplication } from "@/components/create-application";

export const metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const db = getPrisma();
  const apps = await db.application.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { cases: true, cycles: true, environments: true } },
      cycles: { where: { kind: { not: "SIMULATION" } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return (
    <>
      <PageHeader
        title="Applications"
        subtitle="Each application under test has its own cases, cycles, environments, context and reports."
        actions={<CreateApplication />}
      />
      {apps.length === 0 ? (
        <EmptyState title="No applications yet" action={<CreateApplication primary />}>
          Add the application you are testing (for example KFastTrack), then import its checklist or create cases.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => (
            <Link key={a.id} href={`/apps/${a.id}`} className="card block p-4 transition hover:border-teal-500 hover:shadow">
              <h2 className="font-semibold text-navy-900">{a.name}</h2>
              {a.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{a.description}</p>}
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
                <div className="rounded bg-slate-50 py-1.5">
                  <dt>Cases</dt>
                  <dd className="text-base font-semibold text-slate-800">{a._count.cases}</dd>
                </div>
                <div className="rounded bg-slate-50 py-1.5">
                  <dt>Cycles</dt>
                  <dd className="text-base font-semibold text-slate-800">{a._count.cycles}</dd>
                </div>
                <div className="rounded bg-slate-50 py-1.5">
                  <dt>Environments</dt>
                  <dd className="text-base font-semibold text-slate-800">{a._count.environments}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-slate-500">
                Latest cycle:{" "}
                {a.cycles[0] ? <span className="font-medium text-slate-700">{a.cycles[0].name}</span> : "none"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
