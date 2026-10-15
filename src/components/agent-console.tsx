"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { IconFail, IconPass, IconPause, IconPlay } from "@/components/icons";
import type { runView } from "@/server/services/run-service";

type View = Awaited<ReturnType<typeof runView>>;
type Item = View["items"][number];
type Step = NonNullable<View["focus"]>["steps"][number];

/**
 * What the AI is doing, step by step, beside the live browser, and how to step in:
 * pause, tell it something, stop this case, or take control of the browser (live view).
 * Interrupts reach the runner within about a second, even while the AI is thinking.
 */
export function AgentConsole({
  appId,
  runId,
  item,
  steps,
  live,
  following,
  onFollow,
  onPin,
  onRefresh,
}: {
  appId: string;
  runId: string;
  /** The case shown: the one running now, or the one that ran last. */
  item: Item | null;
  steps: Step[];
  live: boolean;
  /** True while the log follows whichever case is running. */
  following: boolean;
  onFollow: () => void;
  /** Keep showing this case even after the AI moves on. */
  onPin: (itemId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const running = live && item?.status === "RUNNING";

  // Follow new steps unless the person scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [steps.length, item?.id]);

  async function control(action: "pause" | "resume" | "message" | "stop_case", body?: string) {
    if (!item) return;
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/runs/${runId}/control`, { method: "POST", json: { itemId: item.id, action, text: body } });
      if (action === "message") setText("");
      stick.current = true;
      await onRefresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  function stopCase() {
    if (!item) return;
    const reason = window.prompt("Stop this case and hand it to you in Needs you?\nOptional: why (the note is kept with the result).", "");
    if (reason === null) return;
    // Stay on this case so the hand-over is visible even though the AI moves on.
    onPin(item.id);
    void control("stop_case", reason || undefined);
  }

  const state = !item
    ? null
    : !running
      ? item.result
        ? "Finished"
        : item.openRequests.length
          ? "Waiting for you"
          : item.status === "WAITING"
            ? "Waiting for another case"
            : "Not running"
      : item.takeover === "ACTIVE"
        ? "You have the browser"
        : item.takeover === "REQUESTED"
          ? "Handing you the browser…"
          : item.pause === "PAUSED"
            ? "Paused"
            : item.pause === "REQUESTED"
              ? "Pausing…"
              : "Working";

  return (
    <section aria-label="What the AI is doing" className="flex h-[28rem] flex-col overflow-hidden rounded-lg border border-slate-200 xl:h-[40rem]">
      <header className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Steps</h2>
          {state && (
            <span className={`flex items-center gap-1.5 text-xs ${state === "Working" ? "text-accent-700" : state === "Paused" || state === "You have the browser" ? "font-medium text-ink-900" : "text-slate-600"}`}>
              {state === "Working" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-600" aria-hidden="true" />}
              {state}
            </span>
          )}
        </div>
        {item && (
          <p className="mt-0.5 truncate text-sm">
            <span className="case-id">{item.externalId}</span> <span className="text-ink-800">{item.title}</span>
          </p>
        )}
        {!following && live && (
          <p className="mt-1 text-xs text-slate-500">
            Viewing this case.{" "}
            <button type="button" className="text-accent-700 hover:underline" onClick={onFollow}>
              Back to the live case
            </button>
          </p>
        )}
      </header>

      <ol
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {steps.length === 0 && <li className="py-6 text-center text-sm text-slate-500">{item ? "Steps appear here as the AI works." : "No case has started yet."}</li>}
        {steps.map((s, i) => {
          if (s.kind === "SYSTEM") {
            return (
              <li key={s.id} className="flex items-center gap-2 py-1 text-xs text-slate-500">
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                {s.label}
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </li>
            );
          }
          if (s.kind === "PERSON") {
            return (
              <li key={s.id} className="ml-6 rounded-md bg-slate-100 px-2.5 py-1.5 text-sm">
                <p className="text-ink-900">{s.label}</p>
                {s.result && <p className="text-xs text-slate-500">{s.result}</p>}
              </li>
            );
          }
          const pending = s.result === null && running && i === steps.length - 1;
          const open = expanded === s.id;
          return (
            <li key={s.id}>
              <button type="button" className="flex w-full gap-2 rounded-md px-1 py-1 text-left hover:bg-slate-50" onClick={() => setExpanded(open ? null : s.id)} aria-expanded={open}>
                <span className="mt-[3px] flex w-4 shrink-0 justify-center">
                  {pending ? (
                    <span className="mt-1 h-1.5 w-1.5 animate-pulse rounded-full bg-accent-600" aria-label="in progress" />
                  ) : s.ok === true ? (
                    <IconPass size={13} className="text-green-700" aria-label="worked" />
                  ) : s.ok === false ? (
                    <IconFail size={13} className="text-red-700" aria-label="did not work" />
                  ) : (
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink-900">
                    {s.kind === "RECIPE" && <span className="mr-1 text-xs text-slate-500">recipe</span>}
                    {s.label}
                  </span>
                  {s.thought && <span className={`block text-xs text-slate-500 ${open ? "" : "line-clamp-2"}`}>{s.thought}</span>}
                  {s.result && (open || s.ok === false) && <span className={`block text-xs ${s.ok === false ? "text-red-700" : "text-slate-600"}`}>{s.result}</span>}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {running && (
        <footer className="space-y-2 border-t border-slate-200 p-3">
          <FormError error={error} />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void control("message", text.trim());
            }}
          >
            <input
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tell the AI something, e.g. use the Acme customer"
              aria-label="Message to the AI"
              maxLength={1000}
            />
            <button className="btn-secondary" type="submit" disabled={!text.trim() || busy !== null}>{busy === "message" ? "Sending…" : "Send"}</button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {item.pause === "NONE" ? (
              <button className="btn-secondary btn-sm" disabled={busy !== null || item.takeover !== "NONE"} onClick={() => control("pause")}>
                <IconPause size={12} /> Pause
              </button>
            ) : (
              <button className="btn-primary btn-sm" disabled={busy !== null} onClick={() => control("resume")}>
                <IconPlay size={12} /> {item.pause === "REQUESTED" ? "Cancel pause" : "Resume"}
              </button>
            )}
            <button className="btn-ghost btn-sm" disabled={busy !== null} onClick={stopCase}>Stop this case</button>
            <span className="ml-auto text-xs text-slate-500">To click and type yourself, use Take control on the browser.</span>
          </div>
        </footer>
      )}
    </section>
  );
}
