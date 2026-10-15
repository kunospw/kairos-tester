"use client";
import { RecipeDraftButton } from "@/components/recipe-draft-button";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { AskCard } from "@/components/ask-card";
import { OutcomeBadge, StatusBar } from "@/components/ui";
import { IconChevronRight, IconNotRun, IconPause } from "@/components/icons";
import type { runView } from "@/server/services/run-service";

type View = Awaited<ReturnType<typeof runView>>;
type Item = View["items"][number];

function ItemStatus({ it }: { it: Item }) {
  if (it.result) {
    return (
      <span className="flex items-center gap-2 whitespace-nowrap">
        <OutcomeBadge outcome={it.result} />
        <span className="text-xs text-slate-500">{it.verifiedBy === "AI" ? "by AI" : `by ${it.verifiedBy}`}</span>
      </span>
    );
  }
  if (it.openRequests.length) return <span className="text-[13px] font-semibold whitespace-nowrap text-ink-900">Needs you</span>;
  if (it.status === "RUNNING")
    return (
      <span className="flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-accent-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-600" aria-hidden="true" /> Running
      </span>
    );
  if (it.status === "WAITING")
    return (
      <span className="flex items-center gap-1 text-[13px] whitespace-nowrap text-slate-600" title={it.statusNote ?? undefined}>
        <IconPause size={12} /> Waiting
      </span>
    );
  if (it.status === "QUEUED")
    return (
      <span className="flex items-center gap-1 text-[13px] whitespace-nowrap text-slate-500">
        <IconNotRun size={12} /> Queued
      </span>
    );
  if (it.status === "SKIPPED") return <span className="text-[13px] whitespace-nowrap text-slate-500">Skipped</span>;
  if (it.status === "NEEDS_HUMAN") return <span className="text-[13px] whitespace-nowrap text-slate-600">With a person</span>;
  return <span className="text-[13px] whitespace-nowrap text-slate-500">{it.status.toLowerCase()}</span>;
}

export function LiveRun({ appId, initial }: { appId: string; initial: View }) {
  const router = useRouter();
  const [v, setV] = useState<View>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<"report" | "cancel" | null>(null);
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
  const running = v.items.find((i) => i.status === "RUNNING") ?? null;
  const asks = v.items.flatMap((i) => i.openRequests.map((r) => ({ item: i, req: r })));
  const waiting = v.items.filter((i) => i.status === "WAITING").length;
  const finished = v.status !== "RUNNING";
  const remaining = t.total - t.done;

  async function createReport() {
    setBusy("report");
    setError(null);
    try {
      const r = await apiFetch<{ id: string }>(`/api/apps/${appId}/reports`, { method: "POST", json: { cycleId: v.cycle.id, title: `Test report: ${v.cycle.name}` } });
      router.push(`/apps/${appId}/reports/${r.id}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  async function cancel() {
    if (!window.confirm("Stop this run? Cases not tested yet stay not tested; results already recorded are kept.")) return;
    setBusy("cancel");
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/runs/${v.id}/cancel`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={`/apps/${appId}/run`} className="mb-1 inline-block text-sm text-slate-500 hover:text-ink-900">← Run tests</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{v.cycle.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {v.environment.name}
              {v.cycle.buildLabel ? ` · build ${v.cycle.buildLabel}` : ""} · model {v.model}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {finished ? (
              <>
                <span className="text-sm text-slate-600">{v.status === "COMPLETED" ? "Finished" : "Cancelled"}</span>
                <button className="btn-primary" disabled={busy !== null} onClick={createReport}>{busy === "report" ? "Creating…" : "Create report"}</button>
              </>
            ) : (
              <button className="btn-secondary" disabled={busy !== null} onClick={cancel}>{busy === "cancel" ? "Stopping…" : "Stop run"}</button>
            )}
          </div>
        </div>
      </div>
      <FormError error={error} />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-8">
          <section>
            <p className="mb-2 text-sm text-ink-800">
              <strong className="text-lg font-semibold tabular-nums">{t.done}</strong> <span className="text-slate-500">of {t.total} done</span>
              {!finished && remaining > 0 && <span className="text-slate-500"> · {remaining} to go</span>}
              {waiting > 0 && <span className="text-slate-500"> · {waiting} waiting on another case</span>}
            </p>
            <StatusBar pass={t.passed} fail={t.failed} blocked={t.blocked} notRun={t.total - t.passed - t.failed - t.blocked} />
          </section>

          {asks.length > 0 && (
            <section>
              <h2 className="mb-1 text-sm font-semibold">Needs you <span className="font-normal text-slate-500">({asks.length})</span></h2>
              <p className="mb-3 text-xs text-slate-500">The AI has moved on to other cases. When you&apos;ve done your part, send it back and the AI checks it again.</p>
              <div className="space-y-3">
                {asks.map(({ item, req }) => (
                  <AskCard
                    key={req.id}
                    appId={appId}
                    req={req}
                    manualHref={`/apps/${appId}/cycles/${item.cycleId ?? v.cycle.id}/run/${item.cycleCaseId}`}
                    expected={item.expected}
                    shots={item.evidence.filter((e) => e.mimeType.startsWith("image/")).slice(-3)}
                    onDone={refresh}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold">All cases</h2>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {v.items.map((it) => (
                <li key={it.id}>
                  <button
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 ${it.status === "RUNNING" ? "bg-accent-50/60" : ""}`}
                    onClick={() => setOpen(open === it.id ? null : it.id)}
                    aria-expanded={open === it.id}
                  >
                    <IconChevronRight size={14} className={`shrink-0 text-slate-400 transition-transform ${open === it.id ? "rotate-90" : ""}`} />
                    <span className="case-id w-14 shrink-0">{it.externalId}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {it.title}
                      {it.purpose === "SETUP" && <span className="ml-2 text-xs text-slate-500">setup</span>}
                    </span>
                    <ItemStatus it={it} />
                  </button>
                  {open === it.id && (
                    <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3 pl-12 text-sm">
                      {it.statusNote && <p className="text-slate-600">{it.statusNote}</p>}
                      {it.summary && <p><span className="text-slate-500">What the AI saw:</span> {it.summary}</p>}
                      {it.expected && <p><span className="text-slate-500">Expected:</span> {it.expected}</p>}
                      {it.evidence.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {it.evidence.filter((e) => e.mimeType.startsWith("image/")).map((e) => (
                            <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer" className="block w-36 overflow-hidden rounded-md border border-slate-200 bg-white hover:border-slate-400">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/api/evidence/${e.id}`} alt={e.caption ?? "screenshot"} className="h-20 w-full object-cover object-top" loading="lazy" />
                              <span className="block truncate px-1 text-xs text-slate-600">{e.caption}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <Link className="text-xs text-accent-700 hover:underline" href={`/apps/${appId}/cycles/${it.cycleId}/run/${it.cycleCaseId}`}>Open the case result</Link>
                        {!["QUEUED", "RUNNING", "WAITING"].includes(it.status) && !(it.status === "DONE" && it.result === "PASS") && <RecipeDraftButton appId={appId} runItemId={it.id} />}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {v.events.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600 hover:text-ink-900">Activity log</summary>
              <ul className="mt-2 space-y-1 border-l border-slate-200 pl-3 text-xs text-slate-600">
                {v.events.map((e, i) => (
                  <li key={i}>
                    <span className="tabular-nums text-slate-400">{new Date(e.at).toLocaleTimeString()}</span> {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <LiveView appId={appId} runId={v.id} live={!finished} runnerOnline={v.runnerOnline} running={running} />
        </aside>
      </div>
    </div>
  );
}

/**
 * The application under test as the AI sees it, beside the run. Frames come from the
 * runner's own browser (Chrome screencast), refreshed about once a second.
 */
function LiveView({ appId, runId, live, runnerOnline, running }: { appId: string; runId: string; live: boolean; runnerOnline: boolean; running: Item | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!live) {
      setFresh(false);
      return;
    }
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/apps/${appId}/runs/${runId}/live`, { cache: "no-store" });
        if (stop) return;
        if (res.status !== 200) {
          setFresh(false);
          return;
        }
        const url = URL.createObjectURL(await res.blob());
        if (stop) return URL.revokeObjectURL(url);
        if (last.current) URL.revokeObjectURL(last.current);
        last.current = url;
        setSrc(url);
        setFresh(true);
      } catch {
        setFresh(false);
      }
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [appId, runId, live]);
  useEffect(() => () => {
    if (last.current) URL.revokeObjectURL(last.current);
  }, []);

  const caption = running ? (
    <>
      <span className="case-id">{running.externalId}</span> <span className="text-ink-800">{running.title}</span>
      <span className="block truncate text-xs text-slate-500">{running.currentStep ?? "Starting…"}</span>
    </>
  ) : live ? (
    <span className="text-slate-500">{runnerOnline ? "Between cases" : "The AI runner is stopped"}</span>
  ) : (
    <span className="text-slate-500">Run finished. Last screen shown.</span>
  );

  return (
    <section aria-label="Live view of the application under test" className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <h2 className="text-sm font-semibold">Live view</h2>
        <span className={`flex items-center gap-1.5 text-xs ${fresh ? "text-ink-900" : "text-slate-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${fresh ? "bg-red-600" : "bg-slate-300"}`} aria-hidden="true" />
          {fresh ? "Live" : "Not streaming"}
        </span>
      </div>
      <div className="relative aspect-[1366/900] bg-slate-100">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={running ? `What the AI sees while testing ${running.externalId}` : "Last screen the AI saw"} className={`h-full w-full object-contain object-top ${fresh ? "" : "opacity-60"}`} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-slate-500">
            {runnerOnline ? (
              <p>The screen appears here when the AI opens the application.</p>
            ) : (
              <>
                <p className="font-medium text-ink-800">The AI runner is stopped</p>
                <p>
                  Start it in a second terminal: <code className="rounded bg-white px-1 ring-1 ring-slate-200">npm run runner</code>
                </p>
              </>
            )}
          </div>
        )}
      </div>
      <div className="min-h-14 border-t border-slate-200 px-3 py-2 text-sm">{caption}</div>
    </section>
  );
}
