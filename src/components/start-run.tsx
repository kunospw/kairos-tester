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

  return (
    <section className="card overflow-hidden">
      <div className="space-y-4 p-5">
        <FormError error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sr-env">Test on</label>
            <select id="sr-env" className="input" value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
              {environments.map((e) => <option key={e.id} value={e.id}>{e.name}{e.disposable ? " (throwaway data)" : ""}</option>)}
            </select>
          </div>
          {kind === "new" && (
            <div>
              <label className="label" htmlFor="sr-build">Build / version</label>
              <input id="sr-build" className="input" value={buildLabel} onChange={(e) => setBuildLabel(e.target.value)} placeholder="optional, e.g. 1.4.2" />
            </div>
          )}
        </div>
        {resumable.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Continue or start new">
            <button
              type="button"
              role="radio"
              aria-checked={kind === "continue"}
              onClick={() => setKind("continue")}
              className={`rounded-lg border-2 p-3 text-left ${kind === "continue" ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
            >
              <p className="font-semibold text-navy-900">Pick up where you left off</p>
              <p className="text-sm text-slate-600">
                {resumable[0].notRun} not tested yet in “{resumable[0].name}”. Results are added to that round; what is already recorded stays.
              </p>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={kind === "new"}
              onClick={() => setKind("new")}
              className={`rounded-lg border-2 p-3 text-left ${kind === "new" ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
            >
              <p className="font-semibold text-navy-900">Start a new round</p>
              <p className="text-sm text-slate-600">For a new build: every case starts as not tested.</p>
            </button>
          </div>
        )}
        {kind === "continue" && round && (
          <div className="space-y-2 rounded border border-slate-200 p-3">
            {resumable.length > 1 && (
              <select className="input" value={cycleId} onChange={(e) => setCycleId(e.target.value)} aria-label="Round to continue">
                {resumable.map((r) => <option key={r.id} value={r.id}>{r.name}: {r.notRun} not tested</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeBlocked} onChange={(e) => setIncludeBlocked(e.target.checked)} disabled={!round.blocked} />
              Also retry the {round.blocked} blocked case{round.blocked === 1 ? "" : "s"}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeFailed} onChange={(e) => setIncludeFailed(e.target.checked)} disabled={!round.failed} />
              Also retest the {round.failed} failed case{round.failed === 1 ? "" : "s"} (e.g. after a fix)
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={withSetup} onChange={(e) => setWithSetup(e.target.checked)} />
              <span>
                Rebuild the test data first: re-run the earlier passed cases that later ones depend on (uploads, mappings, approvals, loads).
                <span className="block text-xs text-slate-500">Setup results are kept in a separate cycle and never change this round.</span>
              </span>
            </label>
          </div>
        )}
        {kind === "new" && (
        <div>
          <p className="label">Which tests</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which tests">
            {([
              ["all", "Everything"],
              ["not_passed_last", "Only what didn't pass last time"],
              ["sections", "Pick sections"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={mode === v}
                onClick={() => setMode(v)}
                className={`rounded-full border px-3 py-1.5 text-sm ${mode === v ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "sections" && (
            <div className="mt-3 grid max-h-56 gap-1 overflow-auto rounded border border-slate-200 p-2 sm:grid-cols-2">
              {sections.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={picked.includes(s)} onChange={(e) => setPicked(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} /> {s}
                </label>
              ))}
            </div>
          )}
        </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 p-5">
        {plan === null ? (
          <p className="text-sm text-slate-500">Working out what the AI can do…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-white p-3 ring-1 ring-teal-200">
                <p className="text-2xl font-semibold text-teal-700">{ai}</p>
                <p className="text-sm text-slate-600">the AI will run{setupCount > 0 && <span className="block text-xs text-slate-500">after {setupCount} setup re-runs</span>}</p>
              </div>
              <button type="button" className="rounded-lg bg-white p-3 text-left ring-1 ring-amber-200 hover:ring-amber-400" onClick={() => setShowList(showList === "NEEDS_HUMAN" ? "" : "NEEDS_HUMAN")}>
                <p className="text-2xl font-semibold text-amber-800">{human.length}</p>
                <p className="text-sm text-slate-600">need you {human.length > 0 && <span className="text-xs text-teal-700">(see why)</span>}</p>
              </button>
              <button type="button" className="rounded-lg bg-white p-3 text-left ring-1 ring-slate-200 hover:ring-slate-400" onClick={() => setShowList(showList === "NOT_ALLOWED" ? "" : "NOT_ALLOWED")}>
                <p className="text-2xl font-semibold text-slate-600">{blocked.length}</p>
                <p className="text-sm text-slate-600">skipped here {blocked.length > 0 && <span className="text-xs text-teal-700">(see why)</span>}</p>
              </button>
            </div>
            {showList && (
              <ul className="mt-3 max-h-60 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2 text-sm">
                {(showList === "NEEDS_HUMAN" ? human : blocked).map((p) => (
                  <li key={p.testCaseId}><strong>{p.externalId}</strong> {p.title} <span className="text-xs text-slate-500">· {p.reason}</span></li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn-accent px-6 py-2.5 text-base" disabled={busy || !plan.length} onClick={start}>
                {busy ? "Starting…" : `Start: ${plan.length - setupCount} test${plan.length - setupCount === 1 ? "" : "s"}${setupCount ? ` + ${setupCount} setup` : ""}`}
              </button>
              <span className="text-xs text-slate-500">Passes the AI proves are recorded automatically. Failures wait for your one-click confirmation.</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
