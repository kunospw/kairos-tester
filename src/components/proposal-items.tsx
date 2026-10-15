"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Alert, FlagBadge } from "@/components/ui";
import { FINDING_TYPE_LABEL } from "@/lib/domain";

export interface ItemView {
  id: string;
  index: number;
  status: string;
  payload: Record<string, unknown>;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  resultingCase: { id: string; externalId: string; versionNumber: number } | null;
  resultingFinding: boolean;
}

export function ProposalItems({ appId, kind, items, cases }: { appId: string; kind: string; items: ItemView[]; cases: { id: string; externalId: string }[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-navy-800">Item {item.index + 1}</span>
            <StatusPill status={item.status} />
          </div>
          {item.status !== "PENDING" ? (
            <Decided appId={appId} item={item} kind={kind} />
          ) : kind === "DRAFT_CASES" ? (
            <DraftCaseItem appId={appId} item={item} cases={cases} />
          ) : kind === "REVIEW_RESULTS" ? (
            <FindingItem appId={appId} item={item} />
          ) : kind === "RECIPE" ? (
            <RecipeItem appId={appId} item={item} />
          ) : (
            <SummaryItem appId={appId} item={item} />
          )}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "ACCEPTED" ? "bg-green-50 text-green-800 ring-green-300" : status === "REJECTED" ? "bg-slate-100 text-slate-600 ring-slate-300" : "bg-amber-50 text-amber-900 ring-amber-300";
  const label = status === "ACCEPTED" ? "✓ Accepted" : status === "REJECTED" ? "✕ Rejected" : "● Pending review";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{label}</span>;
}

function Decided({ appId, item, kind }: { appId: string; item: ItemView; kind: string }) {
  const p = item.payload;
  return (
    <div className="text-sm">
      <p className="font-medium">{String(p.title ?? p.summary ?? "").slice(0, 300) || (kind === "REPORT_SUMMARY" ? "Report summary" : "")}</p>
      <p className="text-xs text-slate-500">
        {item.status.toLowerCase()} by {item.decidedBy} {item.decidedAt}
        {item.decisionNote ? ` · ${item.decisionNote}` : ""}
      </p>
      {item.resultingCase && (
        <p className="mt-1">
          Created{" "}
          <Link className="text-teal-700 underline" href={`/apps/${appId}/cases/${item.resultingCase.id}`}>
            {item.resultingCase.externalId} v{item.resultingCase.versionNumber}
          </Link>
        </p>
      )}
      {item.resultingFinding && <p className="mt-1 text-xs">A review flag was recorded on the case.</p>}
    </div>
  );
}

function useDecision(appId: string, itemId: string) {
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const accept = (body: unknown) => run(() => apiFetch(`/api/apps/${appId}/ai/items/${itemId}/accept`, { method: "POST", json: body }));
  const reject = () => run(() => apiFetch(`/api/apps/${appId}/ai/items/${itemId}/reject`, { method: "POST", json: { note: rejectNote } }));
  const saveEdits = (payload: unknown) => run(() => apiFetch(`/api/apps/${appId}/ai/items/${itemId}`, { method: "PATCH", json: { payload } }));
  return { error, busy, accept, reject, saveEdits, rejectNote, setRejectNote };
}

function RejectControls({ d }: { d: ReturnType<typeof useDecision> }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input className="input w-56" placeholder="Reason for rejecting (optional)" value={d.rejectNote} onChange={(e) => d.setRejectNote(e.target.value)} aria-label="Reject reason" />
      <button className="btn-danger" disabled={d.busy} onClick={d.reject}>Reject</button>
    </span>
  );
}

const lines = (xs: unknown) => (Array.isArray(xs) ? xs.map(String).join("\n") : "");
const toList = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function DraftCaseItem({ appId, item, cases }: { appId: string; item: ItemView; cases: { id: string; externalId: string }[] }) {
  const d = useDecision(appId, item.id);
  const p = item.payload;
  const [title, setTitle] = useState(String(p.title ?? ""));
  const [section, setSection] = useState(String(p.section ?? ""));
  const [role, setRole] = useState(String(p.role ?? ""));
  const [preconditions, setPreconditions] = useState(String(p.preconditions ?? ""));
  const [steps, setSteps] = useState<{ text: string; required: boolean }[]>((p.steps as { text: string; required: boolean }[]) ?? []);
  const [testData, setTestData] = useState(String(p.testData ?? ""));
  const [expected, setExpected] = useState(lines(p.expectedChecks));
  const [priority, setPriority] = useState(String(p.priority ?? "MEDIUM"));
  const [mode, setMode] = useState(String(p.proposedExecutionMode ?? "MANUAL"));
  const [assumptions, setAssumptions] = useState(lines(p.assumptions));
  const [questions, setQuestions] = useState(lines(p.openQuestions));
  const [targetKind, setTargetKind] = useState<"new" | "version">("new");
  const [externalId, setExternalId] = useState("");
  const [targetCase, setTargetCase] = useState(cases[0]?.id ?? "");
  const refs = (p.sourceReferences as string[]) ?? [];
  const warnings = (p.validationWarnings as string[]) ?? [];

  const payload = () => ({
    title,
    section,
    role,
    preconditions,
    steps: steps.filter((s) => s.text.trim()),
    testData,
    expectedChecks: toList(expected),
    priority,
    proposedExecutionMode: mode,
    sourceReferences: refs,
    assumptions: toList(assumptions),
    openQuestions: toList(questions),
    validationWarnings: warnings,
  });

  return (
    <div className="space-y-3 text-sm">
      <FormError error={d.error} />
      {warnings.length > 0 && <Alert kind="warning">{warnings.map((w, i) => <p key={i}>{w}</p>)}</Alert>}
      <div className="grid gap-2 md:grid-cols-3">
        <div className="md:col-span-3"><label className="label">Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label className="label">Section</label><input className="input" value={section} onChange={(e) => setSection(e.target.value)} /></div>
        <div><label className="label">Role</label><input className="input" value={role} onChange={(e) => setRole(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
            </select>
          </div>
          <div>
            <label className="label">Proposed mode</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="MANUAL">Manual</option><option value="AUTOMATED">Automated</option><option value="HYBRID">Hybrid</option>
            </select>
          </div>
        </div>
      </div>
      <div><label className="label">Preconditions</label><textarea className="input" rows={2} value={preconditions} onChange={(e) => setPreconditions(e.target.value)} /></div>
      <div>
        <label className="label">Steps</label>
        <ol className="space-y-1">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="pt-1.5 text-slate-400">{i + 1}.</span>
              <textarea className="input" rows={1} value={s.text} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`Step ${i + 1}`} />
              <label className="flex items-center gap-1 whitespace-nowrap pt-1.5 text-xs">
                <input type="checkbox" checked={s.required} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> required
              </label>
              <button className="btn-secondary btn-sm mt-1" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>×</button>
            </li>
          ))}
        </ol>
        <button className="btn-secondary btn-sm mt-1" onClick={() => setSteps([...steps, { text: "", required: true }])}>+ Step</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div><label className="label">Expected checks (one per line)</label><textarea className="input" rows={4} value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
        <div><label className="label">Test data</label><textarea className="input" rows={4} value={testData} onChange={(e) => setTestData(e.target.value)} /></div>
        <div><label className="label">Assumptions (one per line)</label><textarea className="input" rows={3} value={assumptions} onChange={(e) => setAssumptions(e.target.value)} /></div>
        <div><label className="label">Open questions (one per line)</label><textarea className="input" rows={3} value={questions} onChange={(e) => setQuestions(e.target.value)} /></div>
      </div>
      <p className="text-xs text-slate-600">Supporting references: {refs.length ? refs.join(", ") : <strong>none</strong>}</p>

      <div className="rounded border border-slate-200 bg-slate-50 p-3">
        <p className="label">On accept</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5"><input type="radio" checked={targetKind === "new"} onChange={() => setTargetKind("new")} /> Create new case with ID</label>
          <input className="input w-32" value={externalId} onChange={(e) => setExternalId(e.target.value)} disabled={targetKind !== "new"} placeholder="e.g. SI-07" aria-label="New case ID" />
          {cases.length > 0 && (
            <>
              <label className="flex items-center gap-1.5"><input type="radio" checked={targetKind === "version"} onChange={() => setTargetKind("version")} /> Add as new version of</label>
              <select className="input w-auto" value={targetCase} onChange={(e) => setTargetCase(e.target.value)} disabled={targetKind !== "version"} aria-label="Existing case">
                {cases.map((c) => <option key={c.id} value={c.id}>{c.externalId}</option>)}
              </select>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-accent"
          disabled={d.busy || (targetKind === "new" && !externalId.trim())}
          onClick={() => d.accept({ payload: payload(), target: targetKind === "new" ? { kind: "new", externalId } : { kind: "version", testCaseId: targetCase } })}
        >
          Accept
        </button>
        <button className="btn-secondary" disabled={d.busy} onClick={() => d.saveEdits(payload())}>Save edits</button>
        <RejectControls d={d} />
      </div>
    </div>
  );
}

function FindingItem({ appId, item }: { appId: string; item: ItemView }) {
  const d = useDecision(appId, item.id);
  const p = item.payload;
  const [type, setType] = useState(String(p.type ?? "INCOMPLETE_TESTING"));
  const [summary, setSummary] = useState(String(p.summary ?? ""));
  const warnings = (p.validationWarnings as string[]) ?? [];
  return (
    <div className="space-y-2 text-sm">
      <FormError error={d.error} />
      <p>
        Case <strong>{String(p.caseId)}</strong> <FlagBadge type={type} />
      </p>
      {warnings.length > 0 && <Alert kind="warning">{warnings.join(" ")}</Alert>}
      <div className="grid gap-2 md:grid-cols-3">
        <div>
          <label className="label">Classification</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(FINDING_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="md:col-span-2"><label className="label">Finding</label><textarea className="input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
      </div>
      {p.evidenceQuote ? <blockquote className="border-l-2 border-slate-300 pl-2 text-xs text-slate-600">“{String(p.evidenceQuote)}”</blockquote> : null}
      {p.suggestedAction ? <p className="text-xs text-slate-600">Suggested action: {String(p.suggestedAction)}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-accent" disabled={d.busy || !summary.trim()} onClick={() => d.accept({ type, summary })}>Accept as review flag</button>
        <RejectControls d={d} />
      </div>
      <p className="text-xs text-slate-500">Accepting records a flag on the case in this cycle. The recorded result stays as it is.</p>
    </div>
  );
}

function SummaryItem({ appId, item }: { appId: string; item: ItemView }) {
  const d = useDecision(appId, item.id);
  const [text, setText] = useState(String(item.payload.text ?? ""));
  return (
    <div className="space-y-2 text-sm">
      <FormError error={d.error} />
      <textarea className="input" rows={12} value={text} onChange={(e) => setText(e.target.value)} aria-label="Summary text" />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-accent" disabled={d.busy || !text.trim()} onClick={() => d.accept({ text })}>Accept into report (marked human-reviewed)</button>
        <button className="btn-secondary" disabled={d.busy} onClick={() => d.saveEdits({ text })}>Save edits</button>
        <RejectControls d={d} />
      </div>
    </div>
  );
}

function RecipeItem({ appId, item }: { appId: string; item: ItemView }) {
  const d = useDecision(appId, item.id);
  const p = item.payload;
  const [name, setName] = useState(String(p.name ?? ""));
  const [explanation, setExplanation] = useState(String(p.explanation ?? ""));
  const [scope, setScope] = useState(String(p.scope ?? "ALL"));
  const [priority, setPriority] = useState(String(p.priority ?? 0));
  const [matchRule, setMatchRule] = useState(JSON.stringify(p.matchRule ?? {}, null, 2));
  const [steps, setSteps] = useState(JSON.stringify(p.steps ?? [], null, 2));
  const [checks, setChecks] = useState(JSON.stringify(p.successChecks ?? [], null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const problems = (p.problems as string[]) ?? [];

  const accept = () => {
    try {
      setParseError(null);
      return d.accept({
        name,
        explanation,
        scope,
        priority: Number(priority),
        matchRule: JSON.parse(matchRule),
        steps: JSON.parse(steps),
        successChecks: JSON.parse(checks),
      });
    } catch {
      setParseError("Match rule, steps and checks must be valid JSON.");
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <Alert kind="warning" title="A recipe is a script the runner will follow without asking the AI.">
        Read every step. It runs only inside the application under test, only uploads approved test files and cannot touch protected items. If it fails, the AI takes over.
      </Alert>
      {problems.length > 0 && (
        <Alert kind="error" title="The runner would refuse parts of this draft">
          <ul className="list-disc pl-5">{problems.map((x, n) => <li key={n}>{x}</li>)}</ul>
        </Alert>
      )}
      <label className="block">Name<input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block">Why it should work<textarea className="input mt-1 w-full" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3">
        <label>Use for
          <select className="input mt-1 block" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="SETUP">Setup runs only</option>
            <option value="TEST">Tests only (prepares state; AI still verifies)</option>
            <option value="ALL">Both</option>
          </select>
        </label>
        <label>Priority<input className="input mt-1 block w-24" type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(e.target.value)} /></label>
      </div>
      <label className="block">Applies to cases matching (regular expressions)<textarea className="input mt-1 w-full font-mono text-xs" rows={4} value={matchRule} onChange={(e) => setMatchRule(e.target.value)} /></label>
      <label className="block">Steps<textarea className="input mt-1 w-full font-mono text-xs" rows={12} value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
      <label className="block">Success checks (all must pass)<textarea className="input mt-1 w-full font-mono text-xs" rows={6} value={checks} onChange={(e) => setChecks(e.target.value)} /></label>
      {parseError && <p className="text-red-700">{parseError}</p>}
      <FormError error={d.error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn-primary" disabled={d.busy} onClick={accept}>Accept and activate recipe</button>
        <RejectControls d={d} />
      </div>
    </div>
  );
}
