"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { LifecycleBadge, ModeBadge, OutcomeBadge, PriorityBadge } from "@/components/ui";
import { OUTCOME_LABEL, type AttemptStatusValue, type ExecutionModeValue, type OutcomeValue, type PriorityValue } from "@/lib/domain";

export interface CycleRow {
  cycleCaseId: string;
  testCaseId: string;
  externalId: string;
  title: string;
  section: string | null;
  priority: PriorityValue;
  role: string | null;
  environment: string | null;
  mode: ExecutionModeValue;
  outcome: OutcomeValue;
  lifecycle: AttemptStatusValue | null;
  attempts: number;
  evidence: number;
  flags: number;
  partial: boolean;
  lastTester: string | null;
  lastDate: string | null;
  imported: boolean;
  versionNumber: number;
}

export function CycleCaseTable({ appId, cycleId, rows, simulation, closed }: { appId: string; cycleId: string; rows: CycleRow[]; simulation: boolean; closed: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [result, setResult] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const sections = useMemo(() => [...new Set(rows.map((r) => r.section ?? "(no section)"))], [rows]);

  const filtered = rows.filter(
    (r) =>
      (!q || r.externalId.toLowerCase().includes(q.toLowerCase()) || r.title.toLowerCase().includes(q.toLowerCase())) &&
      (!section || (r.section ?? "(no section)") === section) &&
      (!result || (result === "IN_PROGRESS" ? Boolean(r.lifecycle) : r.outcome === result)),
  );

  async function simulate(ccId: string) {
    setBusyId(ccId);
    setError(null);
    try {
      await apiFetch(`/api/cycle-cases/${ccId}/simulate`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
        <input className="input max-w-xs" placeholder="Search ID or title…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className="input w-auto" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section">
          <option value="">All sections</option>
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-auto" value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
          <option value="">All results</option>
          {(Object.keys(OUTCOME_LABEL) as OutcomeValue[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          <option value="IN_PROGRESS">In progress (draft / running / awaiting review)</option>
        </select>
        <span className="ml-auto self-center text-sm text-slate-500">{filtered.length} of {rows.length}</span>
      </div>
      {error ? <div className="p-3"><FormError error={error} /></div> : null}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Priority</th>
              <th>Role / env</th>
              <th>Mode</th>
              <th>Result</th>
              <th>Last tested</th>
              <th className="text-right">Attempts</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.cycleCaseId}>
                <td className="whitespace-nowrap font-medium">
                  <Link className="text-teal-700 hover:underline" href={`/apps/${appId}/cases/${r.testCaseId}`}>{r.externalId}</Link>
                </td>
                <td className="min-w-64">
                  {r.title}
                  <div className="text-xs text-slate-500">{r.section ?? "no section"} · v{r.versionNumber}</div>
                  <div className="flex flex-wrap gap-1">
                    {r.flags > 0 && <span className="rounded bg-orange-50 px-1 text-xs text-orange-900 ring-1 ring-orange-300">⚑ {r.flags} flag{r.flags > 1 ? "s" : ""}</span>}
                    {r.partial && <span className="rounded bg-orange-50 px-1 text-xs text-orange-900">partial coverage</span>}
                    {r.evidence > 0 && <span className="rounded bg-slate-100 px-1 text-xs text-slate-600">📎 {r.evidence}</span>}
                  </div>
                </td>
                <td><PriorityBadge priority={r.priority} /></td>
                <td className="text-xs">{r.role ?? "—"}<br />{r.environment ?? ""}</td>
                <td><ModeBadge mode={r.mode} /></td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <OutcomeBadge outcome={r.outcome} />
                    {r.lifecycle && <LifecycleBadge status={r.lifecycle} />}
                    {r.imported && <span className="text-xs text-slate-500">imported</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap text-xs">{r.lastDate ?? "—"}<br />{r.lastTester ?? ""}</td>
                <td className="text-right">{r.attempts}</td>
                <td className="whitespace-nowrap text-right">
                  <Link className="btn-secondary btn-sm" href={`/apps/${appId}/cycles/${cycleId}/run/${r.cycleCaseId}`}>
                    {closed ? "View" : r.lifecycle ? "Resume" : r.attempts > 0 ? "Retest / view" : "Execute"}
                  </Link>
                  {simulation && !closed && !r.lifecycle && (
                    <button className="btn-secondary btn-sm ml-1" disabled={busyId === r.cycleCaseId} onClick={() => simulate(r.cycleCaseId)}>
                      {busyId === r.cycleCaseId ? "…" : "Simulated run"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No cases match.</p>}
      </div>
    </div>
  );
}
