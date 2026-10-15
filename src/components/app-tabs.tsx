"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-api";

interface Attention {
  needsYou: number;
  runner: { online: boolean; lastSeenAt: string | null };
}

const POLL_MS = 10_000;

/**
 * Application navigation, ordered by the testing loop: run → answer what needs you →
 * look at results → tidy cases → report. Layouts don't re-render on navigation, so the
 * "Needs you" badge and runner status are fetched here and refreshed on every page change.
 */
export function AppTabs({ appId }: { appId: string }) {
  const path = usePathname();
  const base = `/apps/${appId}`;
  const [att, setAtt] = useState<Attention | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      apiFetch<Attention>(`/api/apps/${appId}/attention`)
        .then((a) => live && setAtt(a))
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

  const tabs: { href: string; label: string; match: (p: string) => boolean; badge?: number }[] = [
    { href: `${base}/run`, label: "▶ Run tests", match: (p) => p.startsWith(`${base}/run`) },
    { href: `${base}/inbox`, label: "Needs you", match: (p) => p.startsWith(`${base}/inbox`) || p.startsWith(`${base}/review`), badge: att?.needsYou },
    { href: base, label: "Results", match: (p) => p === base || p.startsWith(`${base}/cycles`) },
    { href: `${base}/cases`, label: "Test cases", match: (p) => p.startsWith(`${base}/cases`) },
    { href: `${base}/reports`, label: "Reports", match: (p) => p.startsWith(`${base}/reports`) },
    { href: `${base}/settings`, label: "Setup", match: (p) => p.startsWith(`${base}/settings`) || p.startsWith(`${base}/context`) },
  ];

  return (
    <div className="-mb-px mt-2 flex items-end justify-between gap-3">
      <nav className="flex gap-1 overflow-x-auto" aria-label="Application sections">
        {tabs.map((t) => {
          const active = t.match(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                active ? "border-teal-600 text-navy-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white" aria-label={`${t.badge} waiting`}>
                  {t.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      {att && (
        <Link
          href={`${base}/settings#runner`}
          className={`mb-1.5 hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 sm:inline-flex ${
            att.runner.online ? "bg-green-50 text-green-800 ring-green-200" : "bg-slate-50 text-slate-600 ring-slate-200 hover:ring-slate-400"
          }`}
          title={att.runner.online ? "The AI runner is running on this computer." : "The AI runner is not running. Start it with: npm run runner"}
        >
          <span className={`h-2 w-2 rounded-full ${att.runner.online ? "bg-green-600" : "bg-slate-400"}`} aria-hidden="true" />
          AI runner {att.runner.online ? "on" : "off"}
        </Link>
      )}
    </div>
  );
}
