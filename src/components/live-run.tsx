"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import type { runView } from "@/server/services/run-service";

type View = Awaited<ReturnType<typeof runView>>;
type Item = View["items"][number];
type Req = Item["openRequests"][number];

const OUTCOME_TEXT: Record<string, { label: string; cls: string; icon: string }> = {
  PASS: { label: "Passed", cls: "text-green-800 bg-green-50 ring-green-600/30", icon: "✓" },
  FAIL: { label: "Failed", cls: "text-red-800 bg-red-50 ring-red-600/30", icon: "✕" },
  BLOCKED: { label: "Blocked", cls: "text-amber-900 bg-amber-50 ring-amber-600/40", icon: "⊘" },
  NOT_APPLICABLE: { label: "N/A", cls: "text-indigo-800 bg-indigo-50 ring-indigo-400/30", icon: "–" },
};

function statusPill(it: Item) {
  if (it.result) {
    const o = OUTCOME_TEXT[it.result];
    return (
      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${o.cls}`}>
        {o.icon} {o.label}
        <span className="font-normal opacity-80">· {it.verifiedBy === "AI" ? "verified by AI" : `by ${it.verifiedBy}`}</span>
      </span>
    );
  }
  if (it.openRequests.length) return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">● Needs you</span>;
  if (it.status === "RUNNING") return <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">▶ Running</span>;
  if (it.status === "QUEUED") return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">○ Waiting</span>;
  if (it.status === "SKIPPED") return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">– Skipped</span>;
  return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{it.status.toLowerCase()}</span>;
}

export function LiveRun({ appId, initial }: { appId: string; initial: View }) {
  const router = useRouter();
  const [v, setV] = useState<View>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = async () => {
    try {
      setV(await apiFetch<View>(`/api/apps/${appId}/runs/${v.id}`));
    } catch {
      /* keep the last view; the next poll retries */
    }
  };
  useEffect(() => {
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = v.totals;
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
  const running = v.items.find((i) => i.status === "RUNNING");
  const asks = v.items.flatMap((i) => i.openRequests.map((r) => ({ item: i, req: r })));
  const finished = v.status !== "RUNNING";

  async function createReport() {
    setReportBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string }>(`/api/apps/${appId}/reports`, { method: "POST", json: { cycleId: v.cycle.id, title: `Test report: ${v.cycle.name}` } });
      router.push(`/apps/${appId}/reports/${r.id}`);
    } catch (e) {
      setError(e);
      setReportBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/apps/${appId}/run`} className="text-sm text-teal-700 hover:underline">← Runs</Link>
          <h1 className="text-2xl font-semibold text-navy-900">{v.cycle.name}</h1>
          <p className="text-sm text-slate-600">
            {v.environment.name}
            {v.cycle.buildLabel ? ` · build ${v.cycle.buildLabel}` : ""} · AI model {v.model}
          </p>
        </div>
        <div className="text-right">
          {v.status === "RUNNING" ? (
            v.runnerOnline ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm text-green-800 ring-1 ring-green-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-600" aria-hidden="true" /> AI is working
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-sm text-red-800 ring-1 ring-red-200">● AI runner is not running</span>
            )
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">{v.status === "COMPLETED" ? "Finished" : "Cancelled"}</span>
          )}
        </div>
      </div>

      {v.status === "RUNNING" && !v.runnerOnline && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          Start the AI runner: open PowerShell in the <code>kairos-tester</code> folder and run <code className="rounded bg-white px-1">npm run runner</code>. This page updates by itself.
        </div>
      )}

      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-lg font-semibold text-navy-900">{t.done} of {t.total} done</p>
          <p className="text-sm text-slate-600">
            <span className="text-green-800">{t.passed} passed</span> · <span className="text-red-800">{t.failed} failed</span> · <span className="text-amber-900">{t.blocked} blocked</span>
            {t.skipped ? ` · ${t.skipped} skipped` : ""}
          </p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {finished && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-accent" disabled={reportBusy} onClick={createReport}>{reportBusy ? "Creating…" : "Create customer report"}</button>
            {asks.length > 0 && <span className="text-sm text-amber-900">Answer the {asks.length} item(s) below first for a complete report.</span>}
          </div>
        )}
        <FormError error={error} />
      </section>

      {asks.length > 0 && (
        <section className="rounded-lg border-2 border-amber-300 bg-amber-50/60 p-4">
          <h2 className="mb-3 text-lg font-semibold text-amber-950">Needs you ({asks.length})</h2>
          <div className="space-y-3">
            {asks.map(({ item, req }) => (
              <AskCard key={req.id} appId={appId} item={item} req={req} cycleId={v.cycle.id} onDone={refresh} />
            ))}
          </div>
        </section>
      )}

      {running && (
        <section className="card overflow-hidden">
          <div className="grid gap-0 md:grid-cols-2">
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Now running</p>
              <p className="mt-1 font-semibold">{running.externalId} · {running.title}</p>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-600" aria-hidden="true" />
                {running.currentStep ?? "Starting…"}
              </p>
            </div>
            <div className="bg-slate-100">
              {running.lastShotId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/evidence/${running.lastShotId}`} alt="Latest screenshot" className="h-56 w-full object-cover object-top" />
              ) : (
                <div className="flex h-56 items-center justify-center text-sm text-slate-500">Screenshots appear here</div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold text-navy-800">All tests</h2>
        <ul className="divide-y divide-slate-100">
          {v.items.map((it) => (
            <li key={it.id}>
              <button className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}>
                <span className="w-16 shrink-0 font-medium text-navy-900">{it.externalId}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {it.purpose === "SETUP" && <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">setup</span>}
                  {it.title}
                </span>
                {statusPill(it)}
              </button>
              {open === it.id && (
                <div className="space-y-2 bg-slate-50 px-4 pb-4 text-sm">
                  {it.statusNote && <p className="text-slate-600">{it.statusNote}</p>}
                  {it.summary && <p><strong>What the AI saw:</strong> {it.summary}</p>}
                  {it.expected && <p className="text-slate-600"><strong>Expected:</strong> {it.expected}</p>}
                  {it.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {it.evidence.filter((e) => e.mimeType.startsWith("image/")).map((e) => (
                        <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer" className="block w-40 overflow-hidden rounded border border-slate-200 bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/evidence/${e.id}`} alt={e.caption ?? "screenshot"} className="h-24 w-full object-cover object-top" loading="lazy" />
                          <span className="block truncate px-1 text-xs text-slate-600">{e.caption}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <Link className="text-xs text-teal-700 underline" href={`/apps/${appId}/cycles/${it.cycleId}/run/${it.cycleCaseId}`}>Full details</Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {v.events.length > 0 && (
        <details className="card px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Activity</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {v.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleTimeString()}: {e.message}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function AskCard({ appId, item, req, cycleId, onDone }: { appId: string; item: Item; req: Req; cycleId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const send = async (action: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/requests/${req.id}`, { method: "POST", json: { action, text: text || null } });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const manualHref = `/apps/${appId}/cycles/${item.cycleId ?? cycleId}/run/${item.cycleCaseId}`;
  const shots = item.evidence.filter((e) => e.mimeType.startsWith("image/")).slice(-3);

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-amber-200">
      <p className="font-medium text-slate-900">{req.question}</p>
      {req.kind !== "MANUAL_CASE" && req.detail && <p className="mt-1 text-sm text-slate-600">{req.detail}</p>}
      {req.kind === "CONFIRM_RESULT" && item.expected && <p className="mt-1 text-sm text-slate-600"><strong>Expected:</strong> {item.expected}</p>}
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
