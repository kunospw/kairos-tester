"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";

/** Resolve / dismiss / reopen a review flag. Resolving a flag never changes a result. */
export function FindingActions({ appId, findingId, status }: { appId: string; findingId: string; status: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "RESOLVED" | "DISMISSED">(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save(newStatus: "OPEN" | "RESOLVED" | "DISMISSED") {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/findings/${findingId}`, { method: "PATCH", json: { status: newStatus, resolutionNote: note } });
      setMode(null);
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (status !== "OPEN") {
    return (
      <button className="btn-secondary btn-sm mt-2" disabled={busy} onClick={() => save("OPEN")}>
        Reopen
      </button>
    );
  }
  if (!mode) {
    return (
      <div className="mt-2 flex gap-2">
        <button className="btn-secondary btn-sm" onClick={() => setMode("RESOLVED")}>Resolve…</button>
        <button className="btn-secondary btn-sm" onClick={() => setMode("DISMISSED")}>Dismiss…</button>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <FormError error={error} />
      <textarea
        className="input text-xs"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={mode === "RESOLVED" ? "How was this addressed? (e.g. retested in round X)" : "Why is this flag not applicable?"}
        aria-label="Resolution note"
      />
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={busy || !note.trim()} onClick={() => save(mode)}>
          {mode === "RESOLVED" ? "Mark resolved" : "Dismiss flag"}
        </button>
        <button className="btn-secondary btn-sm" onClick={() => setMode(null)}>Cancel</button>
      </div>
    </div>
  );
}
