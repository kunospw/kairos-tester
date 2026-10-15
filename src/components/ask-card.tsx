"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";

export interface AskRequest {
  id: string;
  kind: string;
  question: string;
  detail: string | null;
}

const KIND_LABEL: Record<string, string> = {
  INPUT: "Question from the AI",
  MANUAL_CASE: "Needs a person",
  RUN_ERROR: "The AI got stuck",
  CONFIRM_RESULT: "Confirm the result",
};

/**
 * One thing an AI run handed to a person. Every kind can be sent back to the AI
 * ("check it again") once the person has done their part, so nothing is dropped.
 * Used on the live run page and in the "Needs you" inbox.
 */
export function AskCard({
  appId,
  req,
  manualHref,
  expected,
  shots = [],
  context,
  onDone,
}: {
  appId: string;
  req: AskRequest;
  /** Where to record the case by hand. */
  manualHref: string;
  expected?: string | null;
  shots?: { id: string; caption: string | null }[];
  /** Optional line above the question, e.g. the run it came from. */
  context?: React.ReactNode;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const send = async (action: string) => {
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/requests/${req.id}`, { method: "POST", json: { action, text: text || null } });
      if (onDone) onDone();
      else router.refresh();
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };
  const b = (action: string, label: string, cls = "btn-secondary", disabled = false) => (
    <button className={cls} disabled={Boolean(busy) || disabled} onClick={() => send(action)}>
      {busy === action ? "Sending…" : label}
    </button>
  );

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-1 text-xs text-slate-500">
        {KIND_LABEL[req.kind] ?? "Needs you"}
        {context && <> · {context}</>}
      </p>
      <p className="font-medium text-ink-900">{req.question}</p>
      {req.detail && <p className="mt-1 text-sm text-slate-600">{req.detail}</p>}
      {req.kind === "CONFIRM_RESULT" && expected && (
        <p className="mt-2 text-sm text-slate-600">
          <span className="text-slate-500">Expected:</span> {expected}
        </p>
      )}
      {req.kind === "CONFIRM_RESULT" && shots.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {shots.map((e) => (
            <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer" className="block w-44 overflow-hidden rounded-md border border-slate-200 hover:border-slate-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/evidence/${e.id}`} alt={e.caption ?? "screenshot"} className="h-28 w-full object-cover object-top" loading="lazy" />
              <span className="block truncate px-1.5 py-0.5 text-xs text-slate-600">{e.caption}</span>
            </a>
          ))}
        </div>
      )}
      <FormError error={error} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {req.kind === "INPUT" && (
          <>
            <input
              className="input max-w-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && text && send("answer")}
              placeholder="Your answer"
              aria-label="Your answer"
            />
            {b("answer", "Send answer", "btn-primary", !text)}
          </>
        )}
        {req.kind === "CONFIRM_RESULT" && (
          <>
            {b("confirm", "Confirm", "btn-primary")}
            {b("override_pass", "It passed")}
            {b("override_fail", "Fail")}
            {b("override_blocked", "Blocked")}
            {b("recheck", "Fixed, re-test it", "btn-ghost")}
          </>
        )}
        {req.kind === "MANUAL_CASE" && b("recheck", "Done, let the AI check it", "btn-primary")}
        {req.kind === "RUN_ERROR" && b("recheck", "Let the AI try again", "btn-primary")}
        {(req.kind === "MANUAL_CASE" || req.kind === "RUN_ERROR") && (
          <Link className="btn-secondary" href={manualHref}>Record the result myself</Link>
        )}
        {b("skip", "Skip", "btn-ghost")}
      </div>

      {req.kind !== "INPUT" &&
        (noteOpen ? (
          <input
            className="input mt-2 max-w-md"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={req.kind === "CONFIRM_RESULT" ? "What you fixed, or why (sent with your choice)" : "Note for the AI, sent with your choice"}
            aria-label="Note"
          />
        ) : (
          <button type="button" className="mt-2 text-xs text-slate-500 hover:text-ink-900 hover:underline" onClick={() => setNoteOpen(true)}>
            Add a note
          </button>
        ))}
    </article>
  );
}
