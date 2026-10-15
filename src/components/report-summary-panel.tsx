"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { AiSubmitPreview, type PreparedPreview } from "@/components/ai-submit-preview";

export function ReportSummaryPanel({ appId, reportId, enabled, hasSummary }: { appId: string; reportId: string; enabled: boolean; hasSummary: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);

  async function run(previewOnly: boolean) {
    setBusy(previewOnly ? "preview" : "generate");
    setError(null);
    try {
      const res = await apiFetch<PreparedPreview & { id: string }>(`/api/apps/${appId}/ai/report-summary${previewOnly ? "?preview=1" : ""}`, {
        method: "POST",
        json: { reportId },
      });
      if (previewOnly) setPreview(res);
      else router.push(`/apps/${appId}/context/proposals/${res.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="card">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-800">
        AI summary draft {hasSummary ? "(a reviewed summary is included below)" : "(optional)"}
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-4 text-sm">
        <p className="text-slate-600">
          Drafts a short customer-facing summary from this snapshot&apos;s structured figures. You edit and accept it before it appears in the report.
          {!enabled && " AI is not configured (set OLLAMA_API_KEY)."}
        </p>
        <FormError error={error} />
        {preview && <AiSubmitPreview preview={preview} />}
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={!!busy} onClick={() => run(true)}>{busy === "preview" ? "Preparing…" : "Preview what will be sent"}</button>
          <button className="btn-accent" disabled={!enabled || !preview || !!busy} onClick={() => run(false)}>{busy === "generate" ? "Drafting…" : "Draft summary"}</button>
        </div>
      </div>
    </details>
  );
}
