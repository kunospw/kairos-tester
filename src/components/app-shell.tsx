"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { CountPill } from "@/components/ui";
import { IconChart, IconChevronDown, IconCog, IconInbox, IconList, IconLogout, IconPlay, IconPlus, IconReport, IconSettings } from "@/components/icons";

interface Attention {
  needsYou: number;
  runner: { online: boolean; lastSeenAt: string | null };
}

const POLL_MS = 10_000;

/**
 * The app frame: a fixed sidebar (which application, where to go, is the runner on,
 * who am I) and a content area that is the only thing that changes between pages.
 * Layouts don't re-render on navigation, so the live bits are fetched here.
 */
export function AppShell({ apps, user, children }: { apps: { id: string; name: string }[]; user: string; children: React.ReactNode }) {
  const path = usePathname();
  const appId = path.match(/^\/apps\/([^/]+)/)?.[1] ?? null;
  const app = apps.find((a) => a.id === appId) ?? null;
  const att = useAttention(appId, path);

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="no-print border-b border-slate-200 bg-slate-50 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <Link href="/?all=1" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-900 text-sm font-bold text-white" aria-label="Kairos Tester: all applications">
            K
          </Link>
          <AppSwitcher apps={apps} current={app} />
        </div>

        {app && <AppNav appId={app.id} path={path} needsYou={att?.needsYou ?? 0} />}

        <div className="mt-auto flex flex-wrap items-center gap-0.5 border-t border-slate-200 px-2 py-2 lg:block lg:space-y-0.5">
          {app && att && (
            <Link
              href={`/apps/${app.id}/settings#runner`}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-200/60"
              title={att.runner.online ? "The AI runner is running on this computer." : "Not running. Start it with: npm run runner"}
            >
              <span className="flex w-4 justify-center" aria-hidden="true">
                <span className={`h-2 w-2 rounded-full ${att.runner.online ? "bg-green-600" : "border border-slate-400"}`} />
              </span>
              AI runner {att.runner.online ? "running" : "stopped"}
            </Link>
          )}
          {app && <NotifyToggle />}
          <NavLink href="/settings" active={path === "/settings"} icon={<IconCog />}>Server settings</NavLink>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span className="truncate text-slate-600" title={`Signed in as ${user}`}>{user}</span>
            <SignOut />
          </div>
        </div>
      </aside>
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}

function AppNav({ appId, path, needsYou }: { appId: string; path: string; needsYou: number }) {
  const base = `/apps/${appId}`;
  const items = [
    { href: `${base}/run`, label: "Run tests", icon: <IconPlay />, active: path.startsWith(`${base}/run`) },
    { href: `${base}/inbox`, label: "Needs you", icon: <IconInbox />, active: path.startsWith(`${base}/inbox`) || path.startsWith(`${base}/review`), count: needsYou },
    { href: base, label: "Results", icon: <IconChart />, active: path === base || path.startsWith(`${base}/cycles`) },
    { href: `${base}/cases`, label: "Test cases", icon: <IconList />, active: path.startsWith(`${base}/cases`) },
    { href: `${base}/reports`, label: "Reports", icon: <IconReport />, active: path.startsWith(`${base}/reports`) },
    { href: `${base}/settings`, label: "Setup", icon: <IconSettings />, active: path.startsWith(`${base}/settings`) || path.startsWith(`${base}/context`) },
  ];
  return (
    <nav aria-label="Application" className="flex gap-0.5 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:pt-2">
      {items.map((i) => (
        <NavLink key={i.href} href={i.href} active={i.active} icon={i.icon} count={i.count}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

function NavLink({ href, active, icon, count, children }: { href: string; active: boolean; icon: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm whitespace-nowrap ${
        active ? "bg-white font-medium text-ink-900 ring-1 ring-slate-200" : "text-slate-600 hover:bg-slate-200/60 hover:text-ink-900"
      }`}
    >
      <span className={active ? "text-ink-900" : "text-slate-500"}>{icon}</span>
      <span className="flex-1">{children}</span>
      {count ? <CountPill n={count} /> : null}
    </Link>
  );
}

function AppSwitcher({ apps, current }: { apps: { id: string; name: string }[]; current: { id: string; name: string } | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [path]);
  return (
    <details ref={ref} className="relative min-w-0 flex-1">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-ink-900 hover:bg-slate-200/60 [&::-webkit-details-marker]:hidden">
        <span className="truncate">{current?.name ?? "Kairos Tester"}</span>
        <IconChevronDown size={14} className="shrink-0 text-slate-500" />
      </summary>
      <div className="absolute top-full left-0 z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        <p className="px-2 pt-1 pb-1 text-xs text-slate-500">Applications</p>
        {apps.map((a) => (
          <Link key={a.id} href={`/apps/${a.id}`} className={`block truncate rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 ${a.id === current?.id ? "font-medium text-ink-900" : "text-slate-700"}`}>
            {a.name}
          </Link>
        ))}
        <div className="my-1 border-t border-slate-100" />
        <Link href="/?all=1&new=1" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
          <IconPlus size={14} /> New application
        </Link>
      </div>
    </details>
  );
}

function SignOut() {
  return (
    <button
      type="button"
      className="rounded-md p-1 text-slate-500 hover:bg-slate-200/60 hover:text-ink-900"
      title="Sign out"
      aria-label="Sign out"
      onClick={async () => {
        await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        window.location.href = "/login";
      }}
    >
      <IconLogout />
    </button>
  );
}

function useAttention(appId: string | null, path: string) {
  const [att, setAtt] = useState<Attention | null>(null);
  useEffect(() => {
    if (!appId) {
      setAtt(null);
      return;
    }
    let live = true;
    const load = () =>
      apiFetch<Attention>(`/api/apps/${appId}/attention`)
        .then((a) => {
          if (live) setAtt(a);
        })
        .catch(() => {
          /* keep the last value; the next poll retries */
        });
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [appId, path]);
  // Desktop notification when something new needs the person (opt-in, see NotifyToggle).
  const prev = useRef<{ appId: string; n: number } | null>(null);
  useEffect(() => {
    if (!att || !appId) return;
    const before = prev.current?.appId === appId ? prev.current.n : null;
    prev.current = { appId, n: att.needsYou };
    if (before === null || att.needsYou <= before) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const added = att.needsYou - before;
    const n = new Notification("Kairos Tester: the AI needs you", {
      body: `${added} new item${added === 1 ? "" : "s"} (${att.needsYou} waiting). The AI carries on with other cases meanwhile.`,
      tag: `needs-you-${appId}`,
    });
    n.onclick = () => {
      window.focus();
      window.location.href = `/apps/${appId}/inbox`;
      n.close();
    };
  }, [att, appId]);

  // A count in the tab title, so a question from the AI is visible from other tabs too.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = att?.needsYou ? `(${att.needsYou}) ${base}` : base;
  }, [att?.needsYou, path]);
  return att;
}

/** Ask once for permission to show desktop notifications; hidden once decided. */
function NotifyToggle() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | null>(null);
  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  if (perm !== "default") return null;
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-200/60 hover:text-ink-900"
      onClick={async () => setPerm(await Notification.requestPermission())}
      title="Get a desktop notification when the AI needs you, even in another window"
    >
      <span className="flex w-4 justify-center text-slate-500" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
        </svg>
      </span>
      Turn on notifications
    </button>
  );
}
