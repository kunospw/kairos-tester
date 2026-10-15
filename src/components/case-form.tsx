"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import {
  EXECUTION_MODE_LABEL,
  PRIORITY_LABEL,
  SUGGESTED_CATEGORIES,
  splitSteps,
  type ExecutionModeValue,
  type PriorityValue,
} from "@/lib/domain";

export interface CaseFormValues {
  externalId: string;
  title: string;
  section: string;
  role: string;
  environment: string;
  preconditions: string;
  stepsText: string;
  steps: { text: string; required: boolean }[];
  expectedResult: string;
  testData: string;
  priority: PriorityValue;
  executionMode: ExecutionModeValue;
  categories: string[];
  dependsOn: string;
}

export const emptyCase: CaseFormValues = {
  externalId: "",
  title: "",
  section: "",
  role: "",
  environment: "",
  preconditions: "",
  stepsText: "",
  steps: [],
  expectedResult: "",
  testData: "",
  priority: "MEDIUM",
  executionMode: "MANUAL",
  categories: [],
  dependsOn: "",
};

/** Create (mode "create") or edit-as-new-version (mode "edit"). */
export function CaseForm({
  appId,
  initial,
  mode,
  caseId,
  versionNumber,
  sections,
}: {
  appId: string;
  initial: CaseFormValues;
  mode: "create" | "edit";
  caseId?: string;
  versionNumber?: number;
  sections: string[];
}) {
  const router = useRouter();
  const [v, setV] = useState<CaseFormValues>(() => ({
    ...initial,
    steps: initial.steps.length ? initial.steps : splitSteps(initial.stepsText).map((text) => ({ text, required: true })),
  }));
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CaseFormValues>(k: K, val: CaseFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  function syncStepsFromText(text: string) {
    const parsed = splitSteps(text);
    set("stepsText", text);
    setV((s) => ({
      ...s,
      stepsText: text,
      steps: parsed.map((t, i) => ({ text: t, required: s.steps[i]?.required ?? true })),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title: v.title,
      section: v.section,
      role: v.role,
      environment: v.environment,
      preconditions: v.preconditions,
      stepsText: v.stepsText,
      steps: v.steps,
      expectedResult: v.expectedResult,
      testData: v.testData,
      priority: v.priority,
      executionMode: v.executionMode,
      categories: v.categories,
      dependsOn: v.dependsOn,
    };
    try {
      if (mode === "create") {
        const res = await apiFetch<{ testCase: { id: string } }>(`/api/apps/${appId}/cases`, {
          method: "POST",
          json: { ...body, externalId: v.externalId },
        });
        router.push(`/apps/${appId}/cases/${res.testCase.id}`);
      } else {
        await apiFetch(`/api/apps/${appId}/cases/${caseId}`, {
          method: "PATCH",
          json: { ...body, changeNote, basedOnVersion: versionNumber },
        });
        router.push(`/apps/${appId}/cases/${caseId}?saved=1`);
        router.refresh();
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError error={error} />
      {mode === "edit" && (
        <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Saving creates <strong>version {(versionNumber ?? 0) + 1}</strong>. Version {versionNumber} and every execution that used it stay unchanged.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className="label" htmlFor="cf-id">Case ID</label>
          <input id="cf-id" className="input" value={v.externalId} onChange={(e) => set("externalId", e.target.value)} required disabled={mode === "edit"} placeholder="e.g. SI-07" />
        </div>
        <div className="md:col-span-3">
          <label className="label" htmlFor="cf-title">Title</label>
          <input id="cf-title" className="input" value={v.title} onChange={(e) => set("title", e.target.value)} required />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="cf-section">Section</label>
          <input id="cf-section" className="input" list="cf-sections" value={v.section} onChange={(e) => set("section", e.target.value)} />
          <datalist id="cf-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor="cf-role">Role (sign in as)</label>
          <input id="cf-role" className="input" value={v.role} onChange={(e) => set("role", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cf-env">Environment</label>
          <input id="cf-env" className="input" value={v.environment} onChange={(e) => set("environment", e.target.value)} placeholder="e.g. Demo" />
        </div>
        <div>
          <label className="label" htmlFor="cf-priority">Priority</label>
          <select id="cf-priority" className="input" value={v.priority} onChange={(e) => set("priority", e.target.value as PriorityValue)}>
            {(Object.keys(PRIORITY_LABEL) as PriorityValue[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="cf-mode">Execution mode</label>
          <select id="cf-mode" className="input" value={v.executionMode} onChange={(e) => set("executionMode", e.target.value as ExecutionModeValue)}>
            {(Object.keys(EXECUTION_MODE_LABEL) as ExecutionModeValue[]).map((m) => <option key={m} value={m}>{EXECUTION_MODE_LABEL[m]}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="cf-dep">Depends on</label>
          <input id="cf-dep" className="input" value={v.dependsOn} onChange={(e) => set("dependsOn", e.target.value)} placeholder="e.g. LD-03 done" />
        </div>
      </div>
      <fieldset>
        <legend className="label">Categories (optional, separate from execution mode)</legend>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={v.categories.includes(c)}
                onChange={(e) => set("categories", e.target.checked ? [...v.categories, c] : v.categories.filter((x) => x !== c))}
              />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="cf-pre">Preconditions</label>
        <textarea id="cf-pre" className="input" rows={2} value={v.preconditions} onChange={(e) => set("preconditions", e.target.value)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="label" htmlFor="cf-steps">Steps (one numbered step per line)</label>
          <textarea id="cf-steps" className="input font-mono text-xs" rows={8} value={v.stepsText} onChange={(e) => syncStepsFromText(e.target.value)} placeholder={"1. Open the page.\n2. Do the action.\n3. Check the result."} />
        </div>
        <div>
          <p className="label">Checks used during execution</p>
          {v.steps.length === 0 ? (
            <p className="text-sm text-slate-500">Steps appear here as checks. Untick “required” for optional checks; unfinished required checks prevent Pass.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {v.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded border border-slate-200 px-2 py-1">
                  <span className="text-slate-400">{i + 1}.</span>
                  <span className="prewrap flex-1">{s.text}</span>
                  <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                    <input
                      type="checkbox"
                      checked={s.required}
                      onChange={(e) => set("steps", v.steps.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
                    />
                    required
                  </label>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="label" htmlFor="cf-exp">Expected result</label>
          <textarea id="cf-exp" className="input" rows={4} value={v.expectedResult} onChange={(e) => set("expectedResult", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cf-data">Test data</label>
          <textarea id="cf-data" className="input" rows={4} value={v.testData} onChange={(e) => set("testData", e.target.value)} />
        </div>
      </div>
      {mode === "edit" && (
        <div>
          <label className="label" htmlFor="cf-note">Change note</label>
          <input id="cf-note" className="input" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Why is this changing? (optional)" />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => router.back()}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Create case" : `Save as version ${(versionNumber ?? 0) + 1}`}
        </button>
      </div>
    </form>
  );
}
