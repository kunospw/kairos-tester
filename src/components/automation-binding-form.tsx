"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";

interface Binding {
  runnerType: string;
  externalTestId: string | null;
  scriptRef: string | null;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | string | null;
}

/** Stores a reference to an external automated test. Nothing here runs anything. */
export function AutomationBindingForm({ appId, caseId, binding }: { appId: string; caseId: string; binding: Binding | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [runnerType, setRunnerType] = useState(binding?.runnerType ?? "playwright-local");
  const [externalTestId, setExternalTestId] = useState(binding?.externalTestId ?? "");
  const [scriptRef, setScriptRef] = useState(binding?.scriptRef ?? "");
  const [notes, setNotes] = useState(binding?.notes ?? "");
  const [reviewed, setReviewed] = useState(Boolean(binding?.reviewedBy));
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/cases/${caseId}/automation`, {
        method: "PUT",
        json: { runnerType, externalTestId, scriptRef, notes, reviewed },
      });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e);
    }
  }
  async function remove() {
    try {
      await apiFetch(`/api/apps/${appId}/cases/${caseId}/automation`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-500">
        Optional. A reference to a reviewed script (for example a Playwright spec) for this case. The AI runner tests cases without one.
      </p>
      <FormError error={error} />
      {!editing ? (
        binding ? (
          <>
            <dl className="grid grid-cols-3 gap-1 text-xs">
              <dt className="text-slate-500">Runner</dt><dd className="col-span-2">{binding.runnerType}</dd>
              <dt className="text-slate-500">External test ID</dt><dd className="col-span-2">{binding.externalTestId ?? "—"}</dd>
              <dt className="text-slate-500">Script ref</dt><dd className="col-span-2 break-all">{binding.scriptRef ?? "—"}</dd>
              <dt className="text-slate-500">Reviewed</dt><dd className="col-span-2">{binding.reviewedBy ? `yes, by ${binding.reviewedBy}` : "no"}</dd>
            </dl>
            {binding.notes && <p className="text-xs text-slate-600">{binding.notes}</p>}
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit reference</button>
              <button className="btn-danger btn-sm" onClick={remove}>Remove</button>
            </div>
          </>
        ) : (
          <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>Add automation reference</button>
        )
      ) : (
        <div className="space-y-2">
          <input className="input" value={runnerType} onChange={(e) => setRunnerType(e.target.value)} placeholder="Runner type" aria-label="Runner type" />
          <input className="input" value={externalTestId} onChange={(e) => setExternalTestId(e.target.value)} placeholder="External test ID (e.g. spec title)" aria-label="External test ID" />
          <input className="input" value={scriptRef} onChange={(e) => setScriptRef(e.target.value)} placeholder="Script reference (repo path / commit)" aria-label="Script reference" />
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" />
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I have reviewed this script against the case version
          </label>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={save}>Save reference</button>
            <button className="btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
