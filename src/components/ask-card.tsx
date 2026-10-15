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

/** One thing an AI run asked a person for. Used on the live run page and in the "Needs you" inbox. */
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
  const [busy, setBusy] = useState(false);
  const send = async (action: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/requests/${req.id}`, { method: "POST", json: { action, text: text || null } });
      if (onDone) onDone();
      else router.refresh();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-amber-200">
      {context && <p className="mb-1 text-xs text-slate-500">{context}</p>}
      <p className="font-medium text-slate-900">{req.question}</p>
      {req.kind !== "MANUAL_CASE" && req.detail && <p className="mt-1 text-sm text-slate-600">{req.detail}</p>}
      {req.kind === "CONFIRM_RESULT" && expected && <p className="mt-1 text-sm text-slate-600"><strong>Expected:</strong> {expected}</p>}
      {req.kind === "CONFIRM_RESULT" && shots.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {shots.map((e) => (
            <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer" className="block w-44 overflow-hidden rounded border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/evidence/${e.id}`} alt={e.caption ?? "screenshot"} className="h-28 w-full object-cover object-top" loading="lazy" />
              <span className="block truncate px-1 text-xs text-slate-600">{e.caption}</span>
            </a>
          ))}
        </div>
      )}
      <FormError error={error} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {req.kind === "INPUT" && (
          <>
            <input className="input max-w-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" aria-label="Your answer" />
            <button className="btn-primary" disabled={busy || !text} onClick={() => send("answer")}>Send</button>
          </>
        )}
        {req.kind === "CONFIRM_RESULT" && (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => send("confirm")}>Confirm</button>
            <button className="btn-secondary" disabled={busy} onClick={() => send("override_pass")}>It actually passed</button>
            <button className="btn-secondary" disabled={busy} onClick={() => send("override_fail")}>Fail</button>
            <button className="btn-secondary" disabled={busy} onClick={() => send("override_blocked")}>Blocked</button>
            <input className="input max-w-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
          </>
        )}
        {req.kind === "RUN_ERROR" && (
          <button className="btn-primary" disabled={busy} onClick={() => send("retry")}>Let the AI retry</button>
        )}
        {(req.kind === "MANUAL_CASE" || req.kind === "RUN_ERROR") && (
          <Link className="btn-secondary" href={manualHref}>Do it myself</Link>
        )}
        <button className="btn-secondary" disabled={busy} onClick={() => send("skip")}>Skip</button>
      </div>
    </div>
  );
}
