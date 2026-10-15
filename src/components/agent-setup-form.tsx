"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import type { AgentProfile } from "@/lib/agent-profile";

/** Set up one environment so the AI runner can use it. Plain fields, sensible defaults. */
export function AgentSetupForm({
  appId,
  env,
  onDone,
}: {
  appId: string;
  env: { id: string; name: string; targetUrl: string | null; disposable: boolean; profile: AgentProfile | null };
  onDone?: () => void;
}) {
  const router = useRouter();
  const p = env.profile;
  const [baseUrl, setBaseUrl] = useState(p?.baseUrl ?? env.targetUrl ?? "http://localhost:3000");
  const [signInMethod, setSignInMethod] = useState<"email_code_outbox" | "none">(p?.signIn.method ?? "email_code_outbox");
  const si = p?.signIn.method === "email_code_outbox" ? p.signIn : null;
  const [email, setEmail] = useState(si?.email ?? "");
  const [outboxPath, setOutboxPath] = useState(si?.outboxPath ?? "");
  const [useViewAs, setUseViewAs] = useState(p ? p.roleSwitch.method === "view_as" : true);
  const [roles, setRoles] = useState(
    Object.entries(p?.roleAccounts ?? {})
      .map(([r, a]) => `${r} = ${a ?? "(me)"}`)
      .join("\n"),
  );
  const [caseEnvs, setCaseEnvs] = useState((p?.caseEnvironments ?? []).join(", "));
  const [notes, setNotes] = useState(p?.notes ?? "");
  const [disposable, setDisposable] = useState(env.disposable);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const roleAccounts: Record<string, string | null> = {};
    for (const line of roles.split("\n")) {
      const m = line.match(/^\s*(.+?)\s*=\s*(.+?)\s*$/);
      if (m) roleAccounts[m[1]] = /^\(?me\)?$/i.test(m[2]) ? null : m[2];
    }
    const agentProfile = {
      baseUrl,
      signIn: signInMethod === "none" ? { method: "none" } : { method: "email_code_outbox", email, outboxPath },
      roleSwitch: useViewAs ? { method: "view_as" } : { method: "none" },
      roleAccounts,
      caseEnvironments: caseEnvs.split(",").map((s) => s.trim()).filter(Boolean),
      notes,
    };
    try {
      await apiFetch(`/api/apps/${appId}/environments/${env.id}`, { method: "PATCH", json: { targetUrl: baseUrl, disposable, agentProfile } });
      router.refresh();
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 text-sm">
      <FormError error={error} />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor={`as-url-${env.id}`}>Application address</label>
          <input id={`as-url-${env.id}`} className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
          <p className="mt-1 text-xs text-slate-500">Only addresses on this computer (localhost). The AI can't open any other site.</p>
        </div>
        <div>
          <label className="label" htmlFor={`as-envs-${env.id}`}>Covers test cases marked</label>
          <input id={`as-envs-${env.id}`} className="input" value={caseEnvs} onChange={(e) => setCaseEnvs(e.target.value)} placeholder="e.g. Demo" />
          <p className="mt-1 text-xs text-slate-500">Cases marked with another environment (e.g. Cloud2) come to you instead.</p>
        </div>
      </div>
      <fieldset className="rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Signing in</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={signInMethod === "email_code_outbox"} onChange={() => setSignInMethod("email_code_outbox")} /> Email + one-time code, read from the app&apos;s local code file</label>
        <label className="flex items-center gap-2"><input type="radio" checked={signInMethod === "none"} onChange={() => setSignInMethod("none")} /> No sign-in needed</label>
        {signInMethod === "email_code_outbox" && (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Sign in as (email)" required aria-label="Sign-in email" />
            <input className="input" value={outboxPath} onChange={(e) => setOutboxPath(e.target.value)} placeholder="Code file path (…\data\dev-otp.jsonl)" required aria-label="Code file path" />
          </div>
        )}
      </fieldset>
      <fieldset className="rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Acting as different roles</legend>
        <label className="flex items-center gap-2"><input type="checkbox" checked={useViewAs} onChange={(e) => setUseViewAs(e.target.checked)} /> Switch roles with “View as” (Admin → People)</label>
        <label className="label mt-2" htmlFor={`as-roles-${env.id}`}>Role → account (one per line; “(me)” = the signed-in account)</label>
        <textarea id={`as-roles-${env.id}`} className="input font-mono text-xs" rows={6} value={roles} onChange={(e) => setRoles(e.target.value)} placeholder={"K admin = (me)\nData owner = demo.arlead\nCustomer PM = demo.pm"} />
      </fieldset>
      <div>
        <label className="label" htmlFor={`as-notes-${env.id}`}>Notes for the AI (optional)</label>
        <textarea id={`as-notes-${env.id}`} className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Test data, file locations, quirks…" />
      </div>
      <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3">
        <input type="checkbox" className="mt-0.5" checked={disposable} onChange={(e) => setDisposable(e.target.checked)} />
        <span><strong>Throwaway data</strong>: the AI may run cases that create or delete data here. Only tick this for a local copy you can reset.</span>
      </label>
      <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save AI setup"}</button>
    </form>
  );
}
