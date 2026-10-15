"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Modal } from "@/components/modal";

export function CreateReport({
  appId,
  cycles,
  defaultCycleId,
}: {
  appId: string;
  cycles: { id: string; name: string; scope: string | null; excludedScope: string | null }[];
  defaultCycleId?: string;
}) {
  const router = useRouter();
  const initial = cycles.find((c) => c.id === defaultCycleId) ?? cycles[0];
  const [open, setOpen] = useState(Boolean(defaultCycleId && cycles.some((c) => c.id === defaultCycleId)));
  const [cycleId, setCycleId] = useState(initial.id);
  const [title, setTitle] = useState(`Test report: ${initial.name}`);
  const [includedScope, setIncludedScope] = useState(initial.scope ?? "");
  const [excludedScope, setExcludedScope] = useState(initial.excludedScope ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function pick(id: string) {
    const c = cycles.find((x) => x.id === id)!;
    setCycleId(id);
    setTitle(`Test report: ${c.name}`);
    setIncludedScope(c.scope ?? "");
    setExcludedScope(c.excludedScope ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string }>(`/api/apps/${appId}/reports`, { method: "POST", json: { cycleId, title, includedScope, excludedScope } });
      router.push(`/apps/${appId}/reports/${r.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>+ New report snapshot</button>
      <Modal open={open} onClose={() => setOpen(false)} title="New report snapshot">
        <form onSubmit={submit} className="space-y-3">
          <FormError error={error} />
          <div>
            <label className="label" htmlFor="rp-cycle">Cycle</label>
            <select id="rp-cycle" className="input" value={cycleId} onChange={(e) => pick(e.target.value)}>
              {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rp-title">Title</label>
            <input id="rp-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="rp-in">Included scope</label>
            <textarea id="rp-in" className="input" rows={2} value={includedScope} onChange={(e) => setIncludedScope(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rp-ex">Excluded scope</label>
            <textarea id="rp-ex" className="input" rows={2} value={excludedScope} onChange={(e) => setExcludedScope(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">The snapshot freezes current results, flags and evidence links. Simulated results are never included.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create snapshot"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
