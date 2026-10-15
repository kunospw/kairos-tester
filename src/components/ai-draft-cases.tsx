"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Card } from "@/components/ui";
import { AiSubmitPreview, type PreparedPreview } from "@/components/ai-submit-preview";
import { CONTEXT_CATEGORY_LABEL } from "@/lib/domain";

export function AiDraftCases({
  appId,
  enabled,
  entries,
}: {
  appId: string;
  enabled: boolean;
  entries: { id: string; title: string; status: string; category: string }[];
}) {
  const router = useRouter();
  const [requirement, setRequirement] = useState("");
  const [sectionHint, setSectionHint] = useState("");
  const [maxCases, setMaxCases] = useState(5);
  const [selected, setSelected] = useState<string[]>(() => entries.filter((e) => e.status === "REVIEWED").map((e) => e.id));
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);

  const body = () => ({ requirement, sectionHint: sectionHint || null, maxCases, contextEntryIds: selected });

  async function doPreview() {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await apiFetch<PreparedPreview>(`/api/apps/${appId}/ai/draft-cases?preview=1`, { method: "POST", json: body() }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      const p = await apiFetch<{ id: string }>(`/api/apps/${appId}/ai/draft-cases`, { method: "POST", json: body() });
      router.push(`/apps/${appId}/context/proposals/${p.id}`);
    } catch (e) {
      setError(e); // inputs are kept for retry
      setBusy(null);
    }
  }

  return (
    <Card title="AI: draft test cases from a requirement">
      <div className="space-y-3">
        <FormError error={error} />
        <div>
          <label className="label" htmlFor="ai-req">Requirement</label>
          <textarea
            id="ai-req"
            className="input"
            rows={5}
            value={requirement}
            onChange={(e) => { setRequirement(e.target.value); setPreview(null); }}
            placeholder="Paste or describe the requirement to cover. Only this text and the context entries you tick are sent."
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ai-sec">Section (optional)</label>
            <input id="ai-sec" className="input" value={sectionHint} onChange={(e) => { setSectionHint(e.target.value); setPreview(null); }} />
          </div>
          <div>
            <label className="label" htmlFor="ai-max">Max cases</label>
            <input id="ai-max" type="number" min={1} max={15} className="input" value={maxCases} onChange={(e) => { setMaxCases(Number(e.target.value)); setPreview(null); }} />
          </div>
        </div>
        <fieldset>
          <legend className="label">Context to include</legend>
          {entries.length === 0 ? (
            <p className="text-xs text-slate-500">No context entries yet.</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 p-2">
              {entries.map((e) => (
                <label key={e.id} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(e.id)}
                    onChange={(ev) => { setSelected(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id)); setPreview(null); }}
                  />
                  <span>
                    {e.title} <span className="text-slate-500">· {CONTEXT_CATEGORY_LABEL[e.category]} · {e.status.toLowerCase()}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">Reviewed entries are preselected. Unreviewed entries are labelled as such in the prompt.</p>
        </fieldset>
        {preview && <AiSubmitPreview preview={preview} />}
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={!requirement.trim() || !!busy} onClick={doPreview}>{busy === "preview" ? "Preparing…" : "Preview what will be sent"}</button>
          <button className="btn-accent" disabled={!enabled || !preview || !!busy} onClick={generate} title={!enabled ? "Set OLLAMA_API_KEY to enable" : !preview ? "Preview first" : undefined}>
            {busy === "generate" ? "Generating… (this can take a minute)" : "Generate proposals"}
          </button>
        </div>
      </div>
    </Card>
  );
}
