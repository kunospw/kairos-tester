import Link from "next/link";
import { getPrisma } from "@/server/db";
import { aiConfig } from "@/server/ai/ollama";
import { parseProfile } from "@/lib/agent-profile";
import { runnerStatus } from "@/server/services/attention-service";
import { Card, PageHeader } from "@/components/ui";
import { EnvironmentManager } from "@/components/environment-manager";
import { AgentSetupForm } from "@/components/agent-setup-form";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Setup" };

export default async function AppSetupPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const db = getPrisma();
  const [app, environments, batches, bindings, caseCount, contextCount, runner] = await Promise.all([
    db.application.findUniqueOrThrow({ where: { id: appId } }),
    db.environment.findMany({ where: { applicationId: appId }, orderBy: { name: "asc" }, include: { _count: { select: { cycles: true } } } }),
    db.importBatch.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "desc" }, include: { cycle: true } }),
    db.automationBinding.findMany({ where: { testCase: { applicationId: appId } }, include: { testCase: true } }),
    db.testCase.count({ where: { applicationId: appId, archived: false } }),
    db.contextEntry.count({ where: { applicationId: appId } }),
    runnerStatus(db),
  ]);
  const base = `/apps/${appId}`;
  const profiles = new Map(environments.map((e) => [e.id, parseProfile(e.agentProfile)]));
  const readyCount = [...profiles.values()].filter(Boolean).length;
  const keyConfigured = aiConfig().keyConfigured;

  // What still stands between the user and a working AI run, in the order to fix it.
  const steps: { done: boolean; label: string; help: React.ReactNode }[] = [
    {
      done: caseCount > 0,
      label: caseCount ? `${caseCount} test cases` : "Add test cases",
      help: <Link className="underline" href={`${base}/cases/import`}>Import your checklist (XLSX / CSV)</Link>,
    },
    {
      done: environments.length > 0,
      label: environments.length ? `${environments.length} environment(s)` : "Add the environment you test against",
      help: <a className="underline" href="#environments">Add one below</a>,
    },
    {
      done: readyCount > 0,
      label: readyCount ? `AI knows how to use ${readyCount} environment(s)` : "Teach the AI how to sign in",
      help: <a className="underline" href="#ai-setup">Fill in the AI setup below</a>,
    },
    {
      done: keyConfigured,
      label: keyConfigured ? "AI key configured" : "Add the AI key",
      help: <>Set OLLAMA_API_KEY in .env and restart. <Link className="underline" href="/settings">Test the connection</Link></>,
    },
    {
      done: runner.online,
      label: runner.online ? "AI runner is running" : "Start the AI runner",
      help: <a className="underline" href="#runner">How to start it</a>,
    },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Setup" subtitle={app.description ?? "What the AI needs to test this application, and where its knowledge comes from."} />

      <Card title={remaining ? `Getting ready to run tests: ${remaining} step${remaining === 1 ? "" : "s"} left` : "Ready to run tests"}>
        <ol className="space-y-1.5 text-sm">
          {steps.map((s) => (
            <li key={s.label} className="flex flex-wrap items-baseline gap-2">
              <span className={`w-5 shrink-0 font-semibold ${s.done ? "text-green-700" : "text-slate-500"}`} aria-label={s.done ? "done" : "to do"}>
                {s.done ? "✓" : "○"}
              </span>
              <span className={s.done ? "text-slate-700" : "font-medium text-slate-900"}>{s.label}</span>
              {!s.done && <span className="text-xs text-accent-700">{s.help}</span>}
            </li>
          ))}
        </ol>
        {!remaining && (
          <Link className="btn-accent mt-3 inline-block" href={`${base}/run`}>▶ Run tests</Link>
        )}
      </Card>

      <div id="environments">
        <EnvironmentManager
          appId={appId}
          environments={environments.map((e) => ({ id: e.id, name: e.name, type: e.type, targetUrl: e.targetUrl, notes: e.notes, cycles: e._count.cycles }))}
        />
      </div>

      {environments.length > 0 && (
        <Card title="AI setup per environment">
          <div id="ai-setup" className="space-y-2">
            <p className="text-sm text-slate-600">How the AI signs in, switches roles and stays safe on each environment.</p>
            {environments.map((e) => {
              const profile = profiles.get(e.id) ?? null;
              return (
                <details key={e.id} className="rounded border border-slate-200" open={!profile && readyCount === 0}>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium text-ink-900">{e.name}</span>
                    {profile ? (
                      <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-800 ring-1 ring-green-200">✓ ready for AI runs</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">not set up</span>
                    )}
                    {e.disposable && <span className="text-xs text-amber-800">throwaway data</span>}
                  </summary>
                  <div className="border-t border-slate-200 p-3">
                    <AgentSetupForm appId={appId} env={{ id: e.id, name: e.name, targetUrl: e.targetUrl, disposable: e.disposable, profile }} />
                  </div>
                </details>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="AI runner">
          <div id="runner" className="space-y-2 text-sm">
            <p>
              Status:{" "}
              {runner.online ? (
                <strong className="text-green-800">● Running</strong>
              ) : (
                <strong className="text-slate-700">○ Not running</strong>
              )}
              {runner.lastSeenAt && <span className="text-xs text-slate-500"> · last seen {formatDateTime(runner.lastSeenAt)}</span>}
            </p>
            <p className="text-slate-600">
              The runner is a small program on this computer that opens the browser and works through queued cases. Start it in a second terminal in the{" "}
              <code>kairos-tester</code> folder and leave it open:
            </p>
            <pre className="rounded bg-slate-900 px-3 py-2 text-xs text-white">npm run runner</pre>
            <p className="text-xs text-slate-500">
              It needs OLLAMA_API_KEY in .env and a Chromium browser (<code>npx playwright install chromium</code>, or set RUNNER_BROWSER_PATH). You can start runs while it is
              off; they wait for it.
            </p>
            <p className="text-xs text-slate-500">
              While it works, the run page shows the application live beside the results. To also watch it in a real browser window, start it with{" "}
              <code>RUNNER_HEADED=true</code> in .env.
            </p>
            {bindings.length > 0 && (
              <p className="text-xs text-slate-500">
                {bindings.length} case(s) also store a scripted automation reference ({bindings.filter((b) => b.reviewedBy).length} reviewed).
              </p>
            )}
          </div>
        </Card>

        <Card title="What the AI knows about this application">
          <p className="text-sm text-slate-600">
            {contextCount} context entr{contextCount === 1 ? "y" : "ies"}: roles, workflows, business rules. Reviewed context guides the AI when it drafts cases and reviews results.
          </p>
          <Link className="btn-secondary mt-3 inline-block" href={`${base}/context`}>Open knowledge &amp; AI drafting</Link>
        </Card>
      </div>

      <Card title="Import history (provenance)">
        {batches.length === 0 ? (
          <p className="text-sm text-slate-500">No imports yet.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr><th>When</th><th>File</th><th>Sheet</th><th>Into round</th><th>By</th><th>Result</th></tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const s = b.stats as Record<string, number>;
                return (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(b.createdAt)}</td>
                    <td className="text-xs">{b.fileName}<div className="text-slate-500">sha256 {b.fileSha256.slice(0, 12)}…</div></td>
                    <td className="text-xs">{b.sheetName ?? "—"}</td>
                    <td className="text-xs">{b.cycle.name}</td>
                    <td className="text-xs">{b.importedBy}</td>
                    <td className="text-xs">
                      {s.casesCreated ?? 0} created · {s.casesUpdated ?? 0} updated · {s.casesSkipped ?? 0} skipped · {s.errorRows ?? 0} errors · {s.attemptsCreated ?? 0} attempts
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
