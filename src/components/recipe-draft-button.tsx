"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";

/** Asks the AI to draft a recipe from a stuck item. Nothing runs until a person accepts the draft. */
export function RecipeDraftButton({ appId, runItemId }: { appId: string; runItemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const draft = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await apiFetch<{ id: string }>(`/api/apps/${appId}/ai/recipe`, { method: "POST", json: { runItemId } });
      router.push(`/apps/${appId}/context/proposals/${p.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <button className="btn-secondary" disabled={busy} onClick={draft}>{busy ? "Drafting…" : "Draft recipe from this"}</button>
      <p className="text-xs text-slate-500">Sends this case, its steps and what the AI did to the AI provider. You review the draft before the runner can use it.</p>
      <FormError error={error} />
    </div>
  );
}
