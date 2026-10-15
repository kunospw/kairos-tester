"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";

export function CycleSettings({
  appId,
  cycle,
  environments,
}: {
  appId: string;
  cycle: { id: string; buildLabel: string | null; environmentId: string | null; scope: string | null; excludedScope: string | null; status: string };
  environments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [buildLabel, setBuildLabel] = useState(cycle.buildLabel ?? "");
  const [environmentId, setEnvironmentId] = useState(cycle.environmentId ?? "");
  const [scope, setScope] = useState(cycle.scope ?? "");
  const [excludedScope, setExcludedScope] = useState(cycle.excludedScope ?? "");
  const [error, setError] = useState<unknown>(null);

  async function save(extra: Record<string, unknown> = {}) {
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/cycles/${cycle.id}`, {
        method: "PATCH",
        json: { buildLabel, environmentId: environmentId || null, scope, excludedScope, ...extra },
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <details className="card" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-navy-800">
        Cycle details: scope, environment, build
        {cycle.scope && <span className="ml-2 font-normal text-slate-500">Scope: {cycle.scope.slice(0, 80)}</span>}
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-4">
        <FormError error={error} />
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="cs-build">Build label</label>
            <input id="cs-build" className="input" value={buildLabel} onChange={(e) => setBuildLabel(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="cs-env">Environment</label>
            <select id="cs-env" className="input" value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
              <option value="">Not recorded</option>
              {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cs-scope">Included scope</label>
            <textarea id="cs-scope" className="input" rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="cs-ex">Excluded scope</label>
            <textarea id="cs-ex" className="input" rows={3} value={excludedScope} onChange={(e) => setExcludedScope(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-slate-500">Changing the build label here does not change attempts already recorded; each attempt keeps the build it was recorded against.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => save()}>Save details</button>
          {cycle.status === "OPEN" ? (
            <button className="btn-secondary" onClick={() => save({ status: "CLOSED" })}>Close cycle (read-only)</button>
          ) : (
            <button className="btn-secondary" onClick={() => save({ status: "OPEN" })}>Reopen cycle</button>
          )}
        </div>
      </div>
    </details>
  );
}
