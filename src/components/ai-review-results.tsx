"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Card } from "@/components/ui";
import { AiSubmitPreview, type PreparedPreview } from "@/components/ai-submit-preview";

interface Row {
  cycleCaseId: string;
  externalId: string;
  title: string;
  section: string | null;
  outcome: string;
  hasNotes: boolean;
  flagged: boolean;
}

export function AiReviewResults({
  appId,
  enabled,
  cycles,
  cycleId,
  rows,
}: {
  appId: string;
  enabled: boolean;
  cycles: { id: string; name: string }[];
  cycleId: string | null;
  rows: Row[];
}) {
  const router = useRouter();
  const path = usePathname();
  const [selected, setSelected] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
  const sections = useMemo(() => [...new Set(rows.map((r) => r.section ?? "(no section)"))], [rows]);
  const shown = rows.filter((r) => !section || (r.section ?? "(no section)") === section);

  const body = () => ({ cycleId, cycleCaseIds: selected });
  async function doPreview() {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await apiFetch<PreparedPreview>(`/api/apps/${appId}/ai/review?preview=1`, { method: "POST", json: body() }));
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
      const p = await apiFetch<{ id: string }>(`/api/apps/${appId}/ai/review`, { method: "POST", json: body() });
      router.push(`/apps/${appId}/context/proposals/${p.id}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }
  const toggle = (id: string, on: boolean) => {
    setSelected(on ? [...selected, id] : selected.filter((x) => x !== id));
    setPreview(null);
  };

  return (
    <Card title="AI: review results for gaps, ambiguity and contradictions">
      <div className="space-y-3">
        <FormError error={error} />
        {cycles.length === 0 ? (
          <p className="text-sm text-slate-500">No real cycles yet. Import or execute tests first.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <select className="input w-auto" value={cycleId ?? ""} onChange={(e) => router.push(`${path}?cycle=${e.target.value}`)} aria-label="Cycle to review">
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="input w-auto" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section">
                <option value="">All sections</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn-secondary btn-sm" onClick={() => { setSelected([...new Set([...selected, ...shown.filter((r) => r.hasNotes).map((r) => r.cycleCaseId)])].slice(0, 60)); setPreview(null); }}>
                Select shown with notes
              </button>
              <button className="btn-secondary btn-sm" onClick={() => { setSelected([]); setPreview(null); }}>Clear</button>
            </div>
            <div className="max-h-56 overflow-auto rounded border border-slate-200">
              <table className="table-base text-xs">
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.cycleCaseId}>
                      <td className="w-6">
                        <input type="checkbox" checked={selected.includes(r.cycleCaseId)} onChange={(e) => toggle(r.cycleCaseId, e.target.checked)} aria-label={`Select ${r.externalId}`} />
                      </td>
                      <td className="whitespace-nowrap font-medium">{r.externalId}</td>
                      <td>{r.title}</td>
                      <td className="whitespace-nowrap">{r.outcome}</td>
                      <td className="whitespace-nowrap text-slate-500">{r.hasNotes ? "notes" : ""}{r.flagged ? " ⚑" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              {selected.length} selected (max 60). Findings come back as proposals. Accepting one adds a review flag; recorded results are never changed.
            </p>
            {preview && <AiSubmitPreview preview={preview} />}
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={!selected.length || selected.length > 60 || !!busy} onClick={doPreview}>{busy === "preview" ? "Preparing…" : "Preview what will be sent"}</button>
              <button className="btn-accent" disabled={!enabled || !preview || !!busy} onClick={generate} title={!enabled ? "Set OLLAMA_API_KEY to enable" : !preview ? "Preview first" : undefined}>
                {busy === "generate" ? "Reviewing… (this can take a minute)" : "Run AI review"}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
