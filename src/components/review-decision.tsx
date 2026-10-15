"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { OutcomeIcon } from "@/components/ui";
import type { OutcomeValue } from "@/lib/domain";

const CHOICES: { outcome: OutcomeValue; label: string; key: string }[] = [
  { outcome: "PASS", label: "Pass", key: "p" },
  { outcome: "FAIL", label: "Fail", key: "f" },
  { outcome: "BLOCKED", label: "Blocked", key: "b" },
  { outcome: "NOT_APPLICABLE", label: "N/A", key: "n" },
];

/**
 * The reviewer's decision is the human checkpoint; the AI's suggestion is never applied
 * by itself. The first card in the queue listens for P / F / B / N, so a long queue can
 * be worked through from the keyboard.
 */
export function ReviewDecision({
  attemptId,
  proposed,
  proposedReason,
  appId,
  recheckRequestId,
  keyboard = false,
}: {
  attemptId: string;
  proposed: OutcomeValue | null;
  proposedReason: string;
  appId?: string;
  /** Open CONFIRM_RESULT request of an AI run: lets the person send the case back for a re-test. */
  recheckRequestId?: string | null;
  keyboard?: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState(proposedReason);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const decide = useCallback(
    async (outcome: OutcomeValue) => {
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
    },
    [attemptId, reason, router],
  );

  async function recheck() {
    if (!appId || !recheckRequestId) return;
    setBusy("recheck");
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/requests/${recheckRequestId}`, { method: "POST", json: { action: "recheck", text: reason || null } });
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (busy || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const c = CHOICES.find((x) => x.key === e.key.toLowerCase());
      if (c) {
        e.preventDefault();
        void decide(c.outcome);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, busy, decide]);

  return (
    <div className="space-y-2">
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.outcome}
            className={proposed === c.outcome ? "btn-primary" : "btn-secondary"}
            disabled={Boolean(busy)}
            onClick={() => decide(c.outcome)}
            title={proposed === c.outcome ? "The AI's suggestion" : undefined}
          >
            {proposed !== c.outcome && <OutcomeIcon outcome={c.outcome} />}
            {busy === c.outcome ? "Saving…" : c.label}
            {keyboard && <span className={`kbd ${proposed === c.outcome ? "border-ink-600 bg-ink-800 text-white" : ""}`}>{c.key.toUpperCase()}</span>}
          </button>
        ))}
        {recheckRequestId && (
          <button className="btn-ghost" disabled={Boolean(busy)} onClick={recheck} title="Fix it first; the AI revisits the case next and confirms the result">
            {busy === "recheck" ? "Sending…" : "I fixed it, test again"}
          </button>
        )}
      </div>
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? Required for Fail, Blocked and N/A. Or a note for the re-test." aria-label="Reason" />
    </div>
  );
}
