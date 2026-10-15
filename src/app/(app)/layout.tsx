import Link from "next/link";
import { requirePageSession } from "@/server/auth/session";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageSession();
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-navy-800 bg-navy-900 text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-teal-500 text-sm font-bold text-navy-900" aria-hidden="true">
              K
            </span>
            <span className="font-semibold tracking-tight">Kairos Tester</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Main">
            <Link href="/" className="text-navy-100 hover:text-white">Applications</Link>
            <Link href="/settings" className="text-navy-100 hover:text-white">Settings &amp; integrations</Link>
            <span className="hidden text-navy-300 sm:inline" title={`Signed in as ${user.username}`}>
              {user.displayName}
            </span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
    </div>
  );
}
