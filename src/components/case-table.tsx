"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LifecycleBadge, ModeBadge, OutcomeBadge, PriorityBadge } from "@/components/ui";
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

export function CaseTable({ rows, base, cycleId, simulation }: { rows: CaseListRow[]; base: string; cycleId: string | null; simulation: boolean }) {
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [role, setRole] = useState("");
  const [env, setEnv] = useState("");
  const [priority, setPriority] = useState("");
  const [result, setResult] = useState("");
  const [mode, setMode] = useState("");
  const [flagged, setFlagged] = useState(false);

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

  return (
    <div className="card">
      <div className="grid gap-2 border-b border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <input className="input xl:col-span-2" placeholder="Search ID or title…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className="input" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section">
          <option value="">All sections</option>
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {roles.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={env} onChange={(e) => setEnv(e.target.value)} aria-label="Environment">
          <option value="">All environments</option>
          {envs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {(Object.keys(PRIORITY_LABEL) as PriorityValue[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="input" value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
          <option value="">All results</option>
          {(Object.keys(OUTCOME_LABEL) as OutcomeValue[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          <option value="__none">Not in selected cycle</option>
        </select>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Execution mode">
          <option value="">All modes</option>
          {(Object.keys(EXECUTION_MODE_LABEL) as ExecutionModeValue[]).map((m) => <option key={m} value={m}>{EXECUTION_MODE_LABEL[m]}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-slate-600">
        <span>
          Showing <strong>{filtered.length}</strong> of {rows.length}
          {simulation && <span className="ml-2 font-medium text-purple-800">(results from a simulation cycle)</span>}
        </span>
        <span className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> Open review flags only
          </label>
          <button className="btn-secondary btn-sm" onClick={clear}>Clear filters</button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Section</th>
              <th>Role</th>
              <th>Env</th>
              <th>Priority</th>
              <th>Mode</th>
              <th>Result</th>
              <th className="text-right">Ver.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-medium">
                  <Link className="text-teal-700 hover:underline" href={`${base}/cases/${r.id}`}>{r.externalId}</Link>
                </td>
                <td className="min-w-64">
                  <Link className="hover:underline" href={`${base}/cases/${r.id}`}>{r.title}</Link>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {r.openFlags > 0 && (
                      <span className="rounded bg-orange-50 px-1 text-xs text-orange-900 ring-1 ring-orange-300">⚑ {r.openFlags} open flag{r.openFlags > 1 ? "s" : ""}</span>
                    )}
                    {r.categories.map((c) => <span key={c} className="rounded bg-slate-100 px-1 text-xs text-slate-600">{c}</span>)}
                    {r.automation && <span className="rounded bg-sky-50 px-1 text-xs text-sky-800">automation ref</span>}
                  </div>
                </td>
                <td className="max-w-48 text-xs text-slate-600">{r.section ?? "—"}</td>
                <td className="text-xs">{r.role ?? "—"}</td>
                <td className="text-xs">{r.environment ?? "—"}</td>
                <td><PriorityBadge priority={r.priority} /></td>
                <td><ModeBadge mode={r.mode} /></td>
                <td>
                  {r.inCycle && r.outcome ? (
                    <div className="flex flex-col items-start gap-1">
                      {cycleId && r.cycleCaseId ? (
                        <Link href={`${base}/cycles/${cycleId}/run/${r.cycleCaseId}`}><OutcomeBadge outcome={r.outcome} /></Link>
                      ) : (
                        <OutcomeBadge outcome={r.outcome} />
                      )}
                      {r.lifecycle && <LifecycleBadge status={r.lifecycle as AttemptStatusValue} />}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">not in cycle</span>
                  )}
                </td>
                <td className="text-right text-xs text-slate-500">v{r.versionNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No cases match these filters.</p>}
      </div>
    </div>
  );
}
