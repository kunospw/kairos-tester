"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";

interface Planned {
  testCaseId: string;
  externalId: string;
  title: string;
  section: string | null;
  plan: "AUTOMATABLE" | "NEEDS_HUMAN" | "NOT_ALLOWED";
  reason: string | null;
  purpose?: "TEST" | "SETUP";
}

interface Resumable {
  id: string;
  name: string;
  total: number;
  notRun: number;
  blocked: number;
  failed: number;
}

export function StartRun({
  appId,
  environments,
  sections,
  defaultBuild,
  resumable,
}: {
  appId: string;
  environments: { id: string; name: string; disposable: boolean }[];
  sections: string[];
  defaultBuild: string;
  resumable: Resumable[];
}) {
  const [kind, setKind] = useState<"continue" | "new">(resumable.length ? "continue" : "new");
  const [cycleId, setCycleId] = useState(resumable[0]?.id ?? "");
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [includeFailed, setIncludeFailed] = useState(false);
  const [withSetup, setWithSetup] = useState(true);
  const round = resumable.find((r) => r.id === cycleId) ?? null;
  const router = useRouter();
  const [environmentId, setEnvironmentId] = useState(environments[0].id);
  const [buildLabel, setBuildLabel] = useState(defaultBuild);
  const [mode, setMode] = useState<"all" | "not_passed_last" | "sections">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<Planned[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState<"" | "NEEDS_HUMAN" | "NOT_ALLOWED">("");

  const scope =
    kind === "continue"
      ? { mode: "continue_cycle" as const, cycleId, includeBlocked, includeFailed, withSetup }
      : mode === "sections"
        ? { mode, sections: picked }
        : { mode };
  const scopeKey = JSON.stringify({ environmentId, scope });

  useEffect(() => {
    if (kind === "new" && mode === "sections" && picked.length === 0) {
      setPlan([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<{ cases: Planned[] }>(`/api/apps/${appId}/runs/plan`, { method: "POST", json: { environmentId, scope } });
        if (live) setPlan(res.cases);
      } catch (e) {
        if (live) setError(e);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const run = await apiFetch<{ id: string }>(`/api/apps/${appId}/runs`, { method: "POST", json: { environmentId, buildLabel, scope } });
      router.push(`/apps/${appId}/run/${run.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const setupCount = plan?.filter((p) => p.purpose === "SETUP").length ?? 0;
  const ai = (plan?.filter((p) => p.plan === "AUTOMATABLE").length ?? 0) - setupCount;
  const human = plan?.filter((p) => p.plan === "NEEDS_HUMAN") ?? [];
  const blocked = plan?.filter((p) => p.plan === "NOT_ALLOWED") ?? [];

  const tests = (plan?.length ?? 0) - setupCount;
  return (
    <section className="space-y-6">
      <FormError error={error} />
      <Step n={1} title="Where">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sr-env">Environment</label>
            <select id="sr-env" className="input" value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
              {environments.map((e) => <option key={e.id} value={e.id}>{e.name}{e.disposable ? " (throwaway data)" : ""}</option>)}
            </select>
          </div>
          {kind === "new" && (
            <div>
              <label className="label" htmlFor="sr-build">Build or version <span className="font-normal text-slate-500">(optional)</span></label>
              <input id="sr-build" className="input" value={buildLabel} onChange={(e) => setBuildLabel(e.target.value)} placeholder="e.g. 1.4.2" />
            </div>
          )}
        </div>
      </Step>

      <Step n={2} title="What to test">
        {resumable.length > 0 && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Continue or start new">
            <Choice checked={kind === "continue"} onSelect={() => setKind("continue")} title="Continue a round">
              {resumable[0].notRun} not tested yet in {resumable[0].name}. What is already recorded stays.
            </Choice>
            <Choice checked={kind === "new"} onSelect={() => setKind("new")} title="Start a new round">
              For a new build. Every case starts as not tested.
            </Choice>
          </div>
        )}
        {kind === "continue" && round && (
          <div className="space-y-2.5">
            {resumable.length > 1 && (
              <select className="input" value={cycleId} onChange={(e) => setCycleId(e.target.value)} aria-label="Round to continue">
                {resumable.map((r) => <option key={r.id} value={r.id}>{r.name}: {r.notRun} not tested</option>)}
              </select>
            )}
            {round.blocked > 0 && (
              <Check checked={includeBlocked} onChange={setIncludeBlocked}>
                Retry the {round.blocked} blocked case{round.blocked === 1 ? "" : "s"}
              </Check>
            )}
            {round.failed > 0 && (
              <Check checked={includeFailed} onChange={setIncludeFailed}>
                Retest the {round.failed} failed case{round.failed === 1 ? "" : "s"}, e.g. after a fix
              </Check>
            )}
            <Check checked={withSetup} onChange={setWithSetup} hint="Re-runs earlier passed cases that later ones depend on (uploads, mappings, approvals). Their results go to a separate setup round.">
              Rebuild the test data first
            </Check>
          </div>
        )}
        {kind === "new" && (
          <div>
            <div className="inline-flex rounded-md border border-slate-300 p-0.5" role="radiogroup" aria-label="Which tests">
              {([
                ["all", "Everything"],
                ["not_passed_last", "What didn't pass last time"],
                ["sections", "Pick sections"],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={mode === v}
                  onClick={() => setMode(v)}
                  className={`rounded px-3 py-1 text-sm ${mode === v ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-slate-100"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "sections" && (
              <div className="mt-3 grid max-h-56 gap-1.5 overflow-auto rounded-md border border-slate-200 p-3 sm:grid-cols-2">
                {sections.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={picked.includes(s)} onChange={(e) => setPicked(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} /> {s}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </Step>

      <Step n={3} title="Start">
        {plan === null ? (
          <p className="text-sm text-slate-500">Working out what the AI can do…</p>
        ) : (
          <>
            <p className="text-sm text-ink-800">
              The AI will run <strong className="tabular-nums">{ai}</strong> case{ai === 1 ? "" : "s"}
              {setupCount > 0 && <> after <strong className="tabular-nums">{setupCount}</strong> setup re-run{setupCount === 1 ? "" : "s"}</>}.
              {human.length > 0 && (
                <>
                  {" "}
                  <button type="button" className="text-accent-700 underline-offset-2 hover:underline" onClick={() => setShowList(showList === "NEEDS_HUMAN" ? "" : "NEEDS_HUMAN")}>
                    {human.length} need{human.length === 1 ? "s" : ""} you
                  </button>
                  .
                </>
              )}
              {blocked.length > 0 && (
                <>
                  {" "}
                  <button type="button" className="text-accent-700 underline-offset-2 hover:underline" onClick={() => setShowList(showList === "NOT_ALLOWED" ? "" : "NOT_ALLOWED")}>
                    {blocked.length} can&apos;t run here
                  </button>
                  .
                </>
              )}
            </p>
            {showList && (
              <ul className="mt-3 max-h-60 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200 text-sm">
                {(showList === "NEEDS_HUMAN" ? human : blocked).map((p) => (
                  <li key={p.testCaseId} className="flex gap-2 px-3 py-1.5">
                    <span className="case-id shrink-0">{p.externalId}</span>
                    <span className="min-w-0 flex-1">{p.title}<span className="block text-xs text-slate-500">{p.reason}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button className="btn-primary btn-lg" disabled={busy || !plan.length} onClick={start}>
                {busy ? "Starting…" : `Start ${tests} test${tests === 1 ? "" : "s"}`}
              </button>
              <span className="text-xs text-slate-500">Passes the AI can prove are recorded automatically. Everything else waits in Needs you.</span>
            </div>
          </>
        )}
      </Step>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[2rem_minmax(0,1fr)]">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-600" aria-hidden="true">{n}</span>
      <div>
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Choice({ checked, onSelect, title, children }: { checked: boolean; onSelect: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left ${checked ? "border-ink-900 ring-1 ring-ink-900" : "border-slate-300 hover:border-slate-400"}`}
    >
      <span className="flex items-center gap-2 font-medium text-ink-900">
        <span className={`h-3.5 w-3.5 rounded-full border ${checked ? "border-[4px] border-ink-900" : "border-slate-400"}`} aria-hidden="true" />
        {title}
      </span>
      <span className="mt-1 block pl-5.5 text-sm text-slate-600">{children}</span>
    </button>
  );
}

function Check({ checked, onChange, disabled, hint, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? "text-slate-500" : "text-ink-800"}`}>
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>
        {children}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
