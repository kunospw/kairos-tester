"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { IconPaperclip, IconPass } from "@/components/icons";
import { Alert, Card, LifecycleBadge, OutcomeIcon } from "@/components/ui";
import { OUTCOME_LABEL, OUTCOMES_REQUIRING_REASON, type AttemptStatusValue, type OutcomeValue } from "@/lib/domain";

type StepResult = "PASS" | "FAIL" | "BLOCKED" | "NOT_APPLICABLE" | "NOT_RUN";

export interface OpenAttempt {
  id: string;
  attemptNumber: number;
  status: AttemptStatusValue;
  outcome: OutcomeValue | null;
  outcomeReason: string;
  actualResult: string;
  remarks: string;
  partialCoverage: boolean;
  partialCoverageNote: string;
  tester: string;
  executionMethod: "MANUAL" | "HYBRID";
  isSimulated: boolean;
  startedAt: string | null;
  steps: { stepIndex: number; text: string; required: boolean; result: StepResult; note: string }[];
  evidence: { id: string; name: string; mimeType: string; sizeBytes: number; caption: string | null }[];
}

const STEP_OPTIONS: { value: StepResult; label: string }[] = [
  { value: "PASS", label: "Pass" },
  { value: "FAIL", label: "Fail" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "NOT_APPLICABLE", label: "N/A" },
  { value: "NOT_RUN", label: "Not done" },
];

const COMPLETE_OUTCOMES: OutcomeValue[] = ["PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"];

export function ExecutionPanel({
  appId,
  ccId,
  attempt,
  hasHistory,
  closed,
  hybrid,
  defaultTester,
}: {
  appId: string;
  ccId: string;
  attempt: OpenAttempt | null;
  hasHistory: boolean;
  closed: boolean;
  hybrid: boolean;
  defaultTester: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function start() {
    setBusy("start");
    setError(null);
    try {
      await apiFetch(`/api/cycle-cases/${ccId}/attempts`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  if (!attempt) {
    return (
      <Card title="Record a result">
        <FormError error={error} />
        {closed ? (
          <p className="text-sm text-slate-500">The round is closed.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-slate-600">
              {hasHistory
                ? "Starting a retest creates a new attempt. Earlier attempts, results and evidence are kept unchanged."
                : "Start an attempt, perform the steps in the target application, then record what happened."}
            </p>
            <button className="btn-accent" onClick={start} disabled={busy === "start"}>
              {busy === "start" ? "Starting…" : hasHistory ? "Start retest (new attempt)" : "Start execution"}
            </button>
          </div>
        )}
      </Card>
    );
  }

  return <AttemptForm key={attempt.id} appId={appId} attempt={attempt} hybrid={hybrid} defaultTester={defaultTester} />;
}

function AttemptForm({ attempt, hybrid, defaultTester }: { appId: string; attempt: OpenAttempt; hybrid: boolean; defaultTester: string }) {
  const router = useRouter();
  const [steps, setSteps] = useState(attempt.steps);
  const [outcome, setOutcome] = useState<OutcomeValue | "">(attempt.outcome ?? "");
  const [outcomeReason, setOutcomeReason] = useState(attempt.outcomeReason);
  const [actualResult, setActualResult] = useState(attempt.actualResult);
  const [remarks, setRemarks] = useState(attempt.remarks);
  const [partialCoverage, setPartialCoverage] = useState(attempt.partialCoverage);
  const [partialCoverageNote, setPartialCoverageNote] = useState(attempt.partialCoverageNote);
  const [tester, setTester] = useState(attempt.tester || defaultTester);
  const [method, setMethod] = useState<"MANUAL" | "HYBRID">(hybrid ? "HYBRID" : attempt.executionMethod);
  const [checkpoint, setCheckpoint] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");

  const touch = () => setDirty(true);
  const isHybrid = hybrid || method === "HYBRID";
  const needsReason = outcome !== "" && OUTCOMES_REQUIRING_REASON.includes(outcome);
  const unfinishedRequired = steps.filter((s) => s.required && s.result !== "PASS");
  const passBlocked = outcome === "PASS" && (unfinishedRequired.length > 0 || steps.some((s) => s.result === "FAIL"));

  function payload(status?: AttemptStatusValue) {
    return {
      ...(status && status !== "COMPLETED" ? { status } : {}),
      outcome: outcome || null,
      outcomeReason,
      actualResult,
      remarks,
      partialCoverage,
      partialCoverageNote,
      tester,
      executionMethod: method,
      humanCheckpointConfirmed: checkpoint,
      steps: steps.map((s) => ({ stepIndex: s.stepIndex, result: s.result, note: s.note })),
    };
  }

  async function save(status: AttemptStatusValue) {
    setBusy(status);
    setError(null);
    setNotice(null);
    try {
      if (status === "COMPLETED") {
        await apiFetch(`/api/attempts/${attempt.id}/complete`, { method: "POST", json: payload() });
        router.refresh();
        return;
      }
      await apiFetch(`/api/attempts/${attempt.id}`, { method: "PATCH", json: payload(status) });
      setDirty(false);
      setNotice(status === "DRAFT" ? "Draft saved. You can leave and resume later." : `Saved as ${status === "RUNNING" ? "Running" : "Awaiting review"}.`);
      router.refresh();
    } catch (e) {
      setError(e); // the form keeps everything the tester entered
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy("discard");
    setError(null);
    try {
      await apiFetch(`/api/attempts/${attempt.id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setBusy("upload");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("caption", caption);
      await apiFetch(`/api/attempts/${attempt.id}/evidence`, { method: "POST", body: fd });
      if (fileRef.current) fileRef.current.value = "";
      setCaption("");
      setNotice("Evidence uploaded.");
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Attempt {attempt.attemptNumber} <LifecycleBadge status={attempt.status} />
          {attempt.isSimulated && <span className="text-xs font-normal text-slate-600">(simulation round)</span>}
        </span>
      }
      actions={dirty ? <span className="text-xs text-amber-800">Unsaved changes</span> : undefined}
    >
      <div className="space-y-4">
        <FormError error={error} />
        {notice && <Alert kind="success">{notice}</Alert>}

        {steps.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-slate-50 p-2 text-sm">
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setSteps(steps.map((x) => ({ ...x, result: "PASS" })));
                setOutcome("PASS");
                touch();
              }}
            >
              <IconPass size={14} /> Everything worked
            </button>
            <span className="text-xs text-slate-500">Marks every check Pass and the result Pass. You still click Complete, and can change anything first.</span>
          </div>
        )}

        {steps.length > 0 && (
          <fieldset>
            <legend className="label">Checks</legend>
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={s.stepIndex} className="rounded border border-slate-200 p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="prewrap flex-1 text-sm">
                      <span className="mr-1 text-slate-400">{i + 1}.</span>
                      {s.text}
                      {!s.required && <span className="ml-1 text-xs text-slate-500">(optional)</span>}
                    </p>
                    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Result for check ${i + 1}`}>
                      {STEP_OPTIONS.map((o) => (
                        <label
                          key={o.value}
                          className={`cursor-pointer rounded border px-1.5 py-0.5 text-xs ${
                            s.result === o.value ? "border-ink-700 bg-ink-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="radio"
                            className="sr-only"
                            name={`step-${s.stepIndex}`}
                            checked={s.result === o.value}
                            onChange={() => {
                              setSteps(steps.map((x) => (x.stepIndex === s.stepIndex ? { ...x, result: o.value } : x)));
                              // Suggest the overall result from the first problem; it stays editable.
                              if (!outcome && (o.value === "FAIL" || o.value === "BLOCKED")) setOutcome(o.value);
                              touch();
                            }}
                          />
                          <OutcomeIcon outcome={o.value} size={13} /> {o.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  {(s.note || ["FAIL", "BLOCKED", "NOT_APPLICABLE"].includes(s.result)) && (
                    <input
                      className="input mt-1 text-xs"
                      placeholder="What happened? (optional)"
                      value={s.note}
                      onChange={(e) => {
                        setSteps(steps.map((x) => (x.stepIndex === s.stepIndex ? { ...x, note: e.target.value } : x)));
                        touch();
                      }}
                      aria-label={`Note for check ${i + 1}`}
                    />
                  )}
                </li>
              ))}
            </ol>
          </fieldset>
        )}

        <div>
          <label className="label" htmlFor="ex-outcome">Result</label>
          <select id="ex-outcome" className="input md:w-64" value={outcome} onChange={(e) => { setOutcome(e.target.value as OutcomeValue | ""); touch(); }}>
            <option value="">Choose…</option>
            {COMPLETE_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </select>
        </div>

        {needsReason && (
          <div>
            <label className="label" htmlFor="ex-reason">Reason for {OUTCOME_LABEL[outcome as OutcomeValue]} (required)</label>
            <textarea
              id="ex-reason"
              className="input"
              rows={2}
              value={outcomeReason}
              onChange={(e) => { setOutcomeReason(e.target.value); touch(); }}
              placeholder={outcome === "BLOCKED" ? "What is missing? (setup, data, access, earlier case failed…)" : outcome === "FAIL" ? "How did the application differ from the expected result?" : "Why doesn't this case apply to this build/environment?"}
            />
          </div>
        )}
        {passBlocked && (
          <Alert kind="warning" title="Pass is not available yet.">
            {unfinishedRequired.length > 0 && <>{unfinishedRequired.length} required check(s) are not marked Pass. </>}
            {steps.some((s) => s.result === "FAIL") && <>A check is marked Fail. </>}
            Complete the checks or record a different result.
          </Alert>
        )}

        <details className="rounded border border-slate-200 p-3" open={Boolean(actualResult || remarks || partialCoverage)}>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">More details (all optional)</summary>
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="ex-actual">Actual result</label>
                <textarea id="ex-actual" className="input" rows={3} value={actualResult} onChange={(e) => { setActualResult(e.target.value); touch(); }} placeholder="What actually happened (screen, message, row)" />
              </div>
              <div>
                <label className="label" htmlFor="ex-remarks">Remarks</label>
                <textarea id="ex-remarks" className="input" rows={3} value={remarks} onChange={(e) => { setRemarks(e.target.value); touch(); }} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="ex-tester">Tester</label>
                <input id="ex-tester" className="input" value={tester} onChange={(e) => { setTester(e.target.value); touch(); }} />
              </div>
              <div>
                <label className="label" htmlFor="ex-method">Execution method</label>
                <select id="ex-method" className="input" value={method} disabled={hybrid} onChange={(e) => { setMethod(e.target.value as "MANUAL" | "HYBRID"); touch(); }}>
                  <option value="MANUAL">Manual</option>
                  <option value="HYBRID">Hybrid (automated steps + human checkpoint)</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={partialCoverage} onChange={(e) => { setPartialCoverage(e.target.checked); touch(); }} />
              Partial coverage: parts of this case were not exercised
            </label>
            {partialCoverage && (
              <textarea className="input" rows={2} value={partialCoverageNote} onChange={(e) => { setPartialCoverageNote(e.target.value); touch(); }} placeholder="What was not covered, and why?" aria-label="Partial coverage explanation" />
            )}
          </div>
        </details>

        {isHybrid && (
          <div className="rounded border border-dashed border-slate-400 bg-slate-50 p-3 text-sm text-ink-800">
            <p className="font-semibold">Hybrid test: human checkpoint required</p>
            <p className="text-xs">Automated actions alone cannot complete this test. Confirm you personally verified the manual checks.</p>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={checkpoint} onChange={(e) => setCheckpoint(e.target.checked)} />
              I ({tester || "tester"}) verified the human checkpoints for this attempt.
            </label>
          </div>
        )}

        <div className="rounded border border-slate-200 p-3">
          <p className="label">Evidence</p>
          {attempt.evidence.length > 0 ? (
            <ul className="mb-2 space-y-1 text-sm">
              {attempt.evidence.map((e) => (
                <li key={e.id}>
                  <a className="text-accent-700 underline" href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer"><IconPaperclip size={13} className="mr-1 inline" />{e.name}</a>{" "}
                  <span className="text-xs text-slate-500">({Math.ceil(e.sizeBytes / 1024)} KB{e.caption ? `, ${e.caption}` : ""})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-xs text-slate-500">No evidence attached yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" className="text-sm" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.json,.har,.mp4,.webm" aria-label="Evidence file" />
            <input className="input w-auto flex-1" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="Evidence caption" />
            <button className="btn-secondary" onClick={upload} disabled={busy === "upload"}>{busy === "upload" ? "Uploading…" : "Upload"}</button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Screenshots, PDFs, logs or short recordings. Stored privately; downloads require sign-in.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <button className="btn-secondary" disabled={!!busy} onClick={() => save("DRAFT")}>{busy === "DRAFT" ? "Saving…" : "Save draft"}</button>
          <button className="btn-secondary" disabled={!!busy} onClick={() => save("RUNNING")}>Mark running</button>
          <button className="btn-secondary" disabled={!!busy} onClick={() => save("AWAITING_REVIEW")}>Mark awaiting review</button>
          <button className="btn-accent" disabled={!!busy || !outcome || passBlocked} onClick={() => save("COMPLETED")}>
            {busy === "COMPLETED" ? "Completing…" : "Complete attempt"}
          </button>
          {attempt.evidence.length === 0 && (
            <button className="btn-danger ml-auto" disabled={!!busy} onClick={discard} title="Delete this unfinished attempt">Discard draft</button>
          )}
        </div>
        <p className="text-xs text-slate-500">Completed attempts are locked. To change a result later, start a retest; the earlier attempt stays in the history.</p>
      </div>
    </Card>
  );
}
