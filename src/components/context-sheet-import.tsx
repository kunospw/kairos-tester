"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui";
import { CONTEXT_CATEGORY_LABEL } from "@/lib/domain";

interface Candidate {
  title: string;
  body: string;
  category: string;
  sourceRows: string;
}

/** Offer a guidance sheet (e.g. "How to use") as UNREVIEWED application context. */
export function ContextSheetImport({ appId, file, sheets }: { appId: string; file: File; sheets: string[] }) {
  const [sheet, setSheet] = useState(sheets.find((s) => /how to use|readme|instructions/i.test(s)) ?? sheets[0] ?? "");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sheet", sheet);
      if (confirm) fd.append("confirm", "1");
      const res = await apiFetch<{ candidates?: Candidate[]; created?: number }>(`/api/apps/${appId}/context/import-sheet`, { method: "POST", body: fd });
      if (confirm) setSaved(res.created ?? 0);
      else setCandidates(res.candidates ?? []);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!sheets.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-800">Optional: use another sheet as application context</h3>
      <p className="text-xs text-slate-600">
        Guidance text (for example a “How to use” sheet) can be saved as <strong>unreviewed</strong> context entries for later human review. These statements are not
        treated as verified requirements, and nothing here affects the case import.
      </p>
      <FormError error={error} />
      {saved !== null ? (
        <Alert kind="success" title={`${saved} unreviewed context entries saved.`}>Review them under Setup → knowledge &amp; AI drafting.</Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <select className="input w-auto" value={sheet} onChange={(e) => { setSheet(e.target.value); setCandidates(null); }} aria-label="Context sheet">
              {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn-secondary" disabled={busy} onClick={() => run(false)}>Preview text blocks</button>
          </div>
          {candidates && (
            <>
              <ul className="max-h-72 space-y-2 overflow-auto rounded border border-slate-200 p-2 text-xs">
                {candidates.map((c, i) => (
                  <li key={i} className="rounded bg-slate-50 p-2">
                    <p className="font-semibold">{c.title} <span className="font-normal text-slate-500">· {CONTEXT_CATEGORY_LABEL[c.category]} (suggested) · {c.sourceRows}</span></p>
                    <p className="prewrap mt-1 line-clamp-4 text-slate-600">{c.body}</p>
                  </li>
                ))}
              </ul>
              <button className="btn-primary" disabled={busy || candidates.length === 0} onClick={() => run(true)}>
                Save {candidates.length} entries as unreviewed context
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
