"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LifecycleBadge, OutcomeBadge, PriorityBadge } from "@/components/ui";
import {
  EXECUTION_MODE_LABEL,
  OUTCOME_LABEL,
  PRIORITY_LABEL,
  type AttemptStatusValue,
  type ExecutionModeValue,
  type OutcomeValue,
  type PriorityValue,
} from "@/lib/domain";

export interface CaseListRow {
  id: string;
  externalId: string;
  title: string;
  section: string | null;
  role: string | null;
  environment: string | null;
  priority: PriorityValue;
  mode: ExecutionModeValue;
  categories: string[];
  versionNumber: number;
  origin: string;
  inCycle: boolean;
  outcome: OutcomeValue | null;
  lifecycle: string | null;
  cycleCaseId: string | null;
  openFlags: number;
  automation: boolean;
}

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

export function CaseTable({ rows, base, cycleId, simulation, roundPicker }: { rows: CaseListRow[]; base: string; cycleId: string | null; simulation: boolean; roundPicker?: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [role, setRole] = useState("");
  const [env, setEnv] = useState("");
  const [priority, setPriority] = useState("");
  const [result, setResult] = useState("");
  const [mode, setMode] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [more, setMore] = useState(false);

  const sections = useMemo(() => uniq(rows.map((r) => r.section)), [rows]);
  const roles = useMemo(() => uniq(rows.map((r) => r.role)).sort(), [rows]);
  const envs = useMemo(() => uniq(rows.map((r) => r.environment)).sort(), [rows]);

  const filtered = rows.filter((r) => {
    if (q) {
      const s = q.toLowerCase();
      if (!r.externalId.toLowerCase().includes(s) && !r.title.toLowerCase().includes(s)) return false;
    }
    if (section && r.section !== section) return false;
    if (role && r.role !== role) return false;
    if (env && r.environment !== env) return false;
    if (priority && r.priority !== priority) return false;
    if (mode && r.mode !== mode) return false;
    if (result === "__none" && r.inCycle) return false;
    if (result && result !== "__none" && r.outcome !== result) return false;
    if (flagged && r.openFlags === 0) return false;
    return true;
  });

  const clear = () => {
    setQ("");
    setSection("");
    setRole("");
    setEnv("");
    setPriority("");
    setResult("");
    setMode("");
    setFlagged(false);
  };

  const active = [section, role, env, priority, result, mode].filter(Boolean).length + (flagged ? 1 : 0) + (q ? 1 : 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input w-64" placeholder="Search ID or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className="input w-auto" value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
          <option value="">Any result</option>
          {(Object.keys(OUTCOME_LABEL) as OutcomeValue[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          <option value="__none">Not in selected round</option>
        </select>
        <select className="input w-auto max-w-56" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section">
          <option value="">Any section</option>
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="btn-ghost" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? "Fewer filters" : "More filters"}
        </button>
        {active > 0 && <button type="button" className="btn-ghost text-slate-500" onClick={clear}>Clear</button>}
        <span className="ml-auto">{roundPicker}</span>
      </div>
      {more && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="">Any role</option>
            {roles.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-auto" value={env} onChange={(e) => setEnv(e.target.value)} aria-label="Environment">
            <option value="">Any environment</option>
            {envs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
            <option value="">Any priority</option>
            {(Object.keys(PRIORITY_LABEL) as PriorityValue[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
          <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Execution mode">
            <option value="">Any mode</option>
            {(Object.keys(EXECUTION_MODE_LABEL) as ExecutionModeValue[]).map((m) => <option key={m} value={m}>{EXECUTION_MODE_LABEL[m]}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-ink-700">
            <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> Open review flags only
          </label>
        </div>
      )}
      <p className="mb-2 text-xs text-slate-500">
        {filtered.length === rows.length ? `${rows.length} cases` : `${filtered.length} of ${rows.length} cases`}
        {simulation && " · results from a simulation round"}
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="table-base">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Section</th>
              <th>Role</th>
              <th>Env</th>
              <th>Priority</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  <Link className="case-id hover:underline" href={`${base}/cases/${r.id}`}>{r.externalId}</Link>
                </td>
                <td className="min-w-64">
                  <Link className="text-ink-900 hover:underline" href={`${base}/cases/${r.id}`}>{r.title}</Link>
                  {(r.openFlags > 0 || r.categories.length > 0 || r.automation || r.versionNumber > 1) && (
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                      {r.openFlags > 0 && <span className="font-medium text-orange-700">{r.openFlags} open flag{r.openFlags > 1 ? "s" : ""}</span>}
                      {r.categories.map((c) => <span key={c}>{c}</span>)}
                      {r.automation && <span>automation ref</span>}
                      {r.versionNumber > 1 && <span>v{r.versionNumber}</span>}
                    </div>
                  )}
                </td>
                <td className="max-w-48 text-slate-600">{r.section ?? "—"}</td>
                <td className="text-slate-600">{r.role ?? "—"}</td>
                <td className="text-slate-600">{r.environment ?? "—"}</td>
                <td><PriorityBadge priority={r.priority} /></td>
                <td>
                  {r.inCycle && r.outcome ? (
                    <div className="flex flex-col items-start gap-0.5">
                      {cycleId && r.cycleCaseId ? (
                        <Link href={`${base}/cycles/${cycleId}/run/${r.cycleCaseId}`} className="hover:underline"><OutcomeBadge outcome={r.outcome} /></Link>
                      ) : (
                        <OutcomeBadge outcome={r.outcome} />
                      )}
                      {r.lifecycle && <LifecycleBadge status={r.lifecycle as AttemptStatusValue} />}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">not in round</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No cases match these filters.</p>}
      </div>
    </div>
  );
}
