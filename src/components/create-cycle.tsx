"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Modal } from "@/components/modal";

export function CreateCycle({
  appId,
  environments,
  sections,
  totalCases,
}: {
  appId: string;
  environments: { id: string; name: string }[];
  sections: { name: string; count: number }[];
  totalCases: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"STANDARD" | "SIMULATION">("STANDARD");
  const [environmentId, setEnvironmentId] = useState("");
  const [buildLabel, setBuildLabel] = useState("");
  const [scope, setScope] = useState("");
  const [excludedScope, setExcludedScope] = useState("");
  const [mode, setMode] = useState<"all" | "sections">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cycle = await apiFetch<{ id: string }>(`/api/apps/${appId}/cycles`, {
        method: "POST",
        json: {
          name,
          kind,
          environmentId: environmentId || null,
          buildLabel,
          scope,
          excludedScope,
          include: mode === "all" ? { mode: "all" } : { mode: "sections", sections: picked },
        },
      });
      router.push(`/apps/${appId}/cycles/${cycle.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const selectedCount = mode === "all" ? totalCases : sections.filter((s) => picked.includes(s.name)).reduce((n, s) => n + s.count, 0);

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)} disabled={totalCases === 0} title={totalCases === 0 ? "Add test cases first" : undefined}>
        + New cycle
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New test cycle" wide>
        <form onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="cy-name">Name</label>
              <input id="cy-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Regression – build 1.4.2" />
            </div>
            <div>
              <label className="label" htmlFor="cy-build">Release / build label</label>
              <input id="cy-build" className="input" value={buildLabel} onChange={(e) => setBuildLabel(e.target.value)} placeholder="e.g. 1.4.2 or commit abc123" />
            </div>
            <div>
              <label className="label" htmlFor="cy-env">Environment</label>
              <select id="cy-env" className="input" value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
                <option value="">Not recorded</option>
                {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              {environments.length === 0 && <p className="mt-1 text-xs text-slate-500">Add environments under App settings.</p>}
            </div>
            <div>
              <span className="label">Type</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={kind === "STANDARD"} onChange={() => setKind("STANDARD")} /> Real test cycle
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={kind === "SIMULATION"} onChange={() => setKind("SIMULATION")} /> Simulation demo (isolated; never in summaries or reports)
              </label>
            </div>
            <div>
              <label className="label" htmlFor="cy-scope">Included scope</label>
              <textarea id="cy-scope" className="input" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cy-ex">Excluded scope</label>
              <textarea id="cy-ex" className="input" rows={2} value={excludedScope} onChange={(e) => setExcludedScope(e.target.value)} />
            </div>
          </div>
          <fieldset>
            <legend className="label">Cases to include</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> All {totalCases} active cases</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === "sections"} onChange={() => setMode("sections")} /> Selected sections</label>
            {mode === "sections" && (
              <div className="mt-2 grid max-h-56 gap-1 overflow-auto rounded border border-slate-200 p-2 md:grid-cols-2">
                {sections.map((s) => (
                  <label key={s.name} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={picked.includes(s.name)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.name] : picked.filter((x) => x !== s.name))} />
                    {s.name} <span className="text-xs text-slate-500">({s.count})</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {selectedCount} case(s) will be assigned at their current version, all starting as <strong>Not run</strong>. Results from earlier cycles or builds are not carried over.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || selectedCount === 0}>{busy ? "Creating…" : "Create cycle"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
