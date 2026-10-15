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
import { IconBlocked, IconFail, IconFlag, IconNotApplicable, IconNotRun, IconPass, IconPause, IconPencil } from "@/components/icons";

// Status is always shape + colour + word, never colour alone.
// Green, red and amber are reserved for Pass, Fail and Blocked.
const OUTCOME_STYLE: Record<OutcomeValue, { text: string; Icon: (p: { size?: number; className?: string }) => React.ReactNode }> = {
  PASS: { text: "text-green-700", Icon: IconPass },
  FAIL: { text: "text-red-700", Icon: IconFail },
  BLOCKED: { text: "text-amber-700", Icon: IconBlocked },
  NOT_RUN: { text: "text-slate-500", Icon: IconNotRun },
  NOT_APPLICABLE: { text: "text-slate-500", Icon: IconNotApplicable },
};

export function OutcomeIcon({ outcome, size = 14 }: { outcome: OutcomeValue; size?: number }) {
  const s = OUTCOME_STYLE[outcome];
  return <s.Icon size={size} className={`shrink-0 ${s.text}`} />;
}

export function OutcomeBadge({ outcome }: { outcome: OutcomeValue }) {
  const s = OUTCOME_STYLE[outcome];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium ${s.text}`}>
      <s.Icon size={14} className="shrink-0" />
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

export function LifecycleBadge({ status }: { status: AttemptStatusValue }) {
  const { cls, Icon } =
    status === "AWAITING_REVIEW"
      ? { cls: "text-accent-700", Icon: IconPause }
      : status === "RUNNING"
        ? { cls: "text-accent-700", Icon: IconNotRun }
        : { cls: "text-slate-500", Icon: IconPencil };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${cls}`}>
      <Icon size={12} className="shrink-0" />
      {ATTEMPT_STATUS_LABEL[status]}
    </span>
  );
}

/** Signal bars, so priority never borrows the result colours. */
export function PriorityBadge({ priority }: { priority: PriorityValue }) {
  const level = { HIGH: 3, MEDIUM: 2, LOW: 1, UNSET: 0 }[priority];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${priority === "HIGH" ? "font-semibold text-ink-900" : "text-slate-500"}`}
      title={`Priority: ${PRIORITY_LABEL[priority]}`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.5" height={3 + i * 3} rx="0.5" className={i < level ? "fill-current" : "fill-slate-200"} />
        ))}
      </svg>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: ExecutionModeValue }) {
  return <span className={`whitespace-nowrap text-xs ${mode === "UNKNOWN" ? "text-slate-500" : "text-slate-600"}`}>{mode === "UNKNOWN" ? "Mode unknown" : EXECUTION_MODE_LABEL[mode]}</span>;
}

export function FlagBadge({ type, title }: { type: string; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-orange-700">
      <IconFlag size={12} className="shrink-0" />
      {FINDING_TYPE_LABEL[type] ?? type}
    </span>
  );
}

/** Small count pill, e.g. next to a nav item. */
export function CountPill({ n, tone = "attention" }: { n: number; tone?: "attention" | "muted" }) {
  if (!n) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
        tone === "attention" ? "bg-ink-900 text-white" : "bg-slate-200 text-slate-700"
      }`}
    >
      {n}
    </span>
  );
}

export function SimulationBanner() {
  return (
    <div role="note" className="rounded-md border border-dashed border-slate-400 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <strong className="font-semibold text-ink-900">Simulation.</strong> These results are simulated for demos. They never appear in metrics or reports.
    </div>
  );
}

export function Alert({
  kind = "info",
  title,
  children,
  action,
}: {
  kind?: "info" | "success" | "warning" | "error";
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const cls = {
    info: "border-slate-200 bg-slate-50 text-ink-800",
    success: "border-green-200 bg-green-50 text-green-900",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    error: "border-red-200 bg-red-50 text-red-900",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2.5 text-sm ${cls}`}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** An invitation, not an error: what this place is for, and the one thing to do first. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink-900">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-1 inline-block text-sm text-slate-500 hover:text-ink-900">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** One bordered strip of numbers, instead of a row of identical cards. */
export function StatStrip({ items }: { items: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "good" | "bad" | "warn" }[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
      {items.map((s) => (
        <div key={s.label} className="border-b border-r border-slate-200 px-4 py-3 last:border-r-0 lg:border-b-0">
          <dt className="text-xs text-slate-500">{s.label}</dt>
          <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${TONE[s.tone ?? "default"]}`}>{s.value}</dd>
          {s.hint && <dd className="mt-0.5 text-xs text-slate-500">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

const TONE = { default: "text-ink-900", good: "text-green-700", bad: "text-red-700", warn: "text-amber-700" };

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "good" | "bad" | "warn" }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${TONE[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", flush = false }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent-700 underline-offset-2 hover:underline">
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
  if (!text) return <span className="text-slate-500">{empty}</span>;
  return <div className="prewrap">{text}</div>;
}

// Status meter colours (validated for deuteranopia/protanopia; pass and fail differ in
// lightness as well as hue). Text never uses these: the legend carries icon + word + count.
const METER = { PASS: "#3aa15f", FAIL: "#a51d1d", BLOCKED: "#e0a43a" } as const;

/**
 * One bar for "how far along is this round": Pass, Fail and Blocked fill it, Not run is
 * the empty track. N/A is excluded (it is not applicable work). Segments are separated by
 * 2px gaps and named in the legend, so colour is never the only cue.
 */
export function StatusBar({
  pass,
  fail,
  blocked,
  notRun,
  legend = true,
  height = 8,
}: {
  pass: number;
  fail: number;
  blocked: number;
  notRun: number;
  legend?: boolean;
  height?: number;
}) {
  const total = pass + fail + blocked + notRun;
  const segs = [
    { key: "PASS" as const, n: pass, label: "Pass" },
    { key: "FAIL" as const, n: fail, label: "Fail" },
    { key: "BLOCKED" as const, n: blocked, label: "Blocked" },
  ].filter((s) => s.n > 0);
  const summary = `${pass} pass, ${fail} fail, ${blocked} blocked, ${notRun} not run, of ${total}`;
  return (
    <div>
      <div role="img" aria-label={summary} className="flex gap-[2px] overflow-hidden rounded bg-slate-200" style={{ height }}>
        {total > 0 &&
          segs.map((s) => (
            <div
              key={s.key}
              title={`${s.label}: ${s.n} of ${total} (${Math.round((s.n / total) * 100)}%)`}
              className="h-full first:rounded-l last:rounded-r"
              style={{ width: `${(s.n / total) * 100}%`, background: METER[s.key] }}
            />
          ))}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-700">
          {(["PASS", "FAIL", "BLOCKED", "NOT_RUN"] as const).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <OutcomeIcon outcome={k} />
              {OUTCOME_LABEL[k]} <span className="font-semibold tabular-nums text-ink-900">{{ PASS: pass, FAIL: fail, BLOCKED: blocked, NOT_RUN: notRun }[k]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "What should I do now?" One sentence and one button, at the top of a page. */
export function NextStep({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink-900">{title}</p>
        {children && <p className="mt-0.5 text-sm text-slate-600">{children}</p>}
      </div>
      {action}
    </div>
  );
}
