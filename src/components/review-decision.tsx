"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import type { OutcomeValue } from "@/lib/domain";

const CHOICES: { outcome: OutcomeValue; label: string; cls: string }[] = [
  { outcome: "PASS", label: "✓ Confirm Pass", cls: "bg-green-700 text-white hover:bg-green-800" },
  { outcome: "FAIL", label: "✕ Fail", cls: "bg-red-700 text-white hover:bg-red-800" },
  { outcome: "BLOCKED", label: "⊘ Blocked", cls: "bg-amber-600 text-white hover:bg-amber-700" },
  { outcome: "NOT_APPLICABLE", label: "– N/A", cls: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" },
];

/** The reviewer's decision is the human checkpoint; the agent's suggestion is never applied automatically. */
export function ReviewDecision({ attemptId, proposed, proposedReason }: { attemptId: string; proposed: OutcomeValue | null; proposedReason: string }) {
  const router = useRouter();
  const [reason, setReason] = useState(proposedReason);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<OutcomeValue | null>(null);

  async function decide(outcome: OutcomeValue) {
    setBusy(outcome);
    setError(null);
    try {
      await apiFetch(`/api/attempts/${attemptId}/complete`, {
        method: "POST",
        json: { outcome, outcomeReason: outcome === "PASS" ? null : reason, humanCheckpointConfirmed: true },
      });
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <FormError error={error} />
      <input
        className="input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required for Fail, Blocked or N/A)"
        aria-label="Reason"
      />
      <div className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.outcome}
            className={`btn ${c.cls} ${proposed === c.outcome ? "ring-2 ring-navy-700 ring-offset-1" : ""}`}
            disabled={!!busy}
            onClick={() => decide(c.outcome)}
          >
            {busy === c.outcome ? "Saving…" : c.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Deciding here records you as the human reviewer of this run.</p>
    </div>
  );
}
