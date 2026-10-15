import Link from "next/link";
import {
  ATTEMPT_STATUS_LABEL,
  EXECUTION_MODE_LABEL,
  FINDING_TYPE_LABEL,
  OUTCOME_LABEL,
  PRIORITY_LABEL,
  type AttemptStatusValue,
  type ExecutionModeValue,
  type OutcomeValue,
  type PriorityValue,
} from "@/lib/domain";

// Status is always shown as symbol + text, never colour alone.
const OUTCOME_STYLE: Record<OutcomeValue, { cls: string; icon: string }> = {
  PASS: { cls: "bg-green-50 text-green-800 ring-green-600/30", icon: "✓" },
  FAIL: { cls: "bg-red-50 text-red-800 ring-red-600/30", icon: "✕" },
  BLOCKED: { cls: "bg-amber-50 text-amber-900 ring-amber-600/40", icon: "⊘" },
  NOT_RUN: { cls: "bg-slate-50 text-slate-700 ring-slate-400/40", icon: "○" },
  NOT_APPLICABLE: { cls: "bg-indigo-50 text-indigo-800 ring-indigo-400/30", icon: "–" },
};

export function OutcomeBadge({ outcome }: { outcome: OutcomeValue }) {
  const s = OUTCOME_STYLE[outcome];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

export function LifecycleBadge({ status }: { status: AttemptStatusValue }) {
  const cls =
    status === "AWAITING_REVIEW"
      ? "bg-purple-50 text-purple-800 ring-purple-500/30"
      : status === "RUNNING"
        ? "bg-sky-50 text-sky-800 ring-sky-500/30"
        : "bg-slate-100 text-slate-700 ring-slate-400/30";
  const icon = status === "AWAITING_REVIEW" ? "⏸" : status === "RUNNING" ? "▶" : "✎";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      <span aria-hidden="true">{icon}</span>
      {ATTEMPT_STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: PriorityValue }) {
  const cls =
    priority === "HIGH"
      ? "text-red-800 bg-red-50 ring-red-200"
      : priority === "MEDIUM"
        ? "text-amber-900 bg-amber-50 ring-amber-200"
        : priority === "LOW"
          ? "text-slate-700 bg-slate-50 ring-slate-200"
          : "text-slate-500 bg-white ring-slate-200";
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function ModeBadge({ mode }: { mode: ExecutionModeValue }) {
  const cls = mode === "UNKNOWN" ? "text-slate-500 border-dashed" : "text-navy-700";
  return (
    <span className={`whitespace-nowrap rounded border border-slate-300 px-1.5 py-0.5 text-xs ${cls}`}>
      {mode === "UNKNOWN" ? "Mode unknown" : EXECUTION_MODE_LABEL[mode]}
    </span>
  );
}

export function FlagBadge({ type, title }: { type: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-orange-50 px-1.5 py-0.5 text-xs font-medium text-orange-900 ring-1 ring-inset ring-orange-300"
    >
      <span aria-hidden="true">⚑</span>
      {FINDING_TYPE_LABEL[type] ?? type}
    </span>
  );
}

export function SimulationBanner() {
  return (
    <div role="note" className="rounded-md border-2 border-dashed border-purple-400 bg-purple-50 px-4 py-2 text-sm text-purple-900">
      <strong>Simulation demo cycle.</strong> Results here are simulated, not real test results. They never appear in
      overview metrics or reports.
    </div>
  );
}

export function Alert({
  kind = "info",
  title,
  children,
}: {
  kind?: "info" | "success" | "warning" | "error";
  title?: string;
  children?: React.ReactNode;
}) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    success: "border-green-200 bg-green-50 text-green-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${cls}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 max-w-lg text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "good" | "bad" | "warn" }) {
  const toneCls = { default: "text-navy-900", good: "text-green-800", bad: "text-red-800", warn: "text-amber-900" }[tone];
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-navy-800">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-teal-700 underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: React.ReactNode; hint?: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Prewrap({ text, empty = "—" }: { text: string | null | undefined; empty?: string }) {
  if (!text) return <span className="text-slate-400">{empty}</span>;
  return <div className="prewrap">{text}</div>;
}
