import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";
import { AppTabs } from "@/components/app-tabs";

export default async function ApplicationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  const app = await getPrisma().application.findUnique({ where: { id: appId } });
  if (!app) notFound();
  return (
    <>
      <div className="no-print mb-4 border-b border-slate-200">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Application under test</p>
        <p className="text-lg font-semibold text-navy-900">{app.name}</p>
        <AppTabs appId={app.id} />
      </div>
      {children}
    </>
  );
}
