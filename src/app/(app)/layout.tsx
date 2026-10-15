import { requirePageSession } from "@/server/auth/session";
import { getPrisma } from "@/server/db";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageSession();
  const apps = await getPrisma().application.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <AppShell apps={apps} user={user.displayName}>
      {children}
    </AppShell>
  );
}
