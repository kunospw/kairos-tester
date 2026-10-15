"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppTabs({ appId }: { appId: string }) {
  const path = usePathname();
  const base = `/apps/${appId}`;
  const tabs = [
    { href: `${base}/run`, label: "▶ Run tests" },
    { href: base, label: "Overview", exact: true },
    { href: `${base}/cases`, label: "Test cases" },
    { href: `${base}/cycles`, label: "Cycles & execution" },
    { href: `${base}/review`, label: "Review inbox" },
    { href: `${base}/context`, label: "Context & AI" },
    { href: `${base}/reports`, label: "Reports" },
    { href: `${base}/settings`, label: "App settings" },
  ];
  return (
    <nav className="-mb-px mt-2 flex gap-1 overflow-x-auto" aria-label="Application sections">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-teal-600 text-navy-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
