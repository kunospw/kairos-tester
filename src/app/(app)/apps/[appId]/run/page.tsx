import Link from "next/link";
import { getPrisma } from "@/server/db";
import { aiConfig } from "@/server/ai/ollama";
import { parseProfile } from "@/lib/agent-profile";
import { listRuns } from "@/server/services/run-service";
import { runnerStatus } from "@/server/services/attention-service";
import { Alert, Card } from "@/components/ui";
import { StartRun } from "@/components/start-run";
import { AgentSetupForm } from "@/components/agent-setup-form";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Run tests" };

export default async function RunPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const db = getPrisma();
  const [envs, cases, runs, lastCycle, runner] = await Promise.all([
    db.environment.findMany({ where: { applicationId: appId }, orderBy: { name: "asc" } }),
    db.testCase.findMany({
      where: { applicationId: appId, archived: false },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { section: true } } },
    }),
    listRuns(db, appId),
    db.testCycle.findFirst({ where: { applicationId: appId, kind: "STANDARD" }, orderBy: { createdAt: "desc" } }),
    runnerStatus(db),
  ]);
  const ready = envs.filter((e) => parseProfile(e.agentProfile));
  // Rounds with work left: cases without a result yet (plus Blocked / Failed for optional retries).
  const openCycles = await db.testCycle.findMany({
    where: { applicationId: appId, kind: { not: "SIMULATION" }, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    include: { cycleCases: { include: { attempts: { orderBy: { attemptNumber: "desc" }, select: { status: true, outcome: true } } } } },
  });
  const resumable = openCycles
    .map((c) => {
      let notRun = 0, blocked = 0, failed = 0;
      for (const cc of c.cycleCases) {
        if (cc.attempts.some((a) => a.status !== "COMPLETED")) continue;
        const last = cc.attempts.find((a) => a.status === "COMPLETED")?.outcome ?? null;
        if (last === null) notRun++;
        else if (last === "BLOCKED") blocked++;
        else if (last === "FAIL") failed++;
      }
      return { id: c.id, name: c.name, total: c.cycleCases.length, notRun, blocked, failed };
    })
    .filter((c) => c.notRun + c.blocked + c.failed > 0);
  const sections = [...new Set(cases.map((c) => c.versions[0]?.section ?? "(no section)"))];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Run tests</h1>
        <p className="mt-1 text-slate-600">The AI works through your test cases in the browser and only asks you for what it can&apos;t do itself.</p>
      </div>

      {!aiConfig().keyConfigured && (
        <Alert kind="warning" title="AI is not configured">Add OLLAMA_API_KEY to .env and restart Kairos Tester.</Alert>
      )}

      {cases.length === 0 ? (
        <Alert kind="info" title="No test cases yet">
          <Link className="underline" href={`/apps/${appId}/cases/import`}>Import your checklist</Link> first.
        </Alert>
      ) : envs.length === 0 ? (
        <Alert kind="info" title="Add the environment you test against">
          Go to <Link className="underline" href={`/apps/${appId}/settings`}>Setup</Link> and add one (for example “Demo (local)”, http://localhost:3000).
        </Alert>
      ) : ready.length === 0 ? (
        <Card title={`One-time setup: teach the AI how to use “${envs[0].name}”`}>
          <AgentSetupForm appId={appId} env={{ id: envs[0].id, name: envs[0].name, targetUrl: envs[0].targetUrl, disposable: envs[0].disposable, profile: null }} />
          {envs.length > 1 && (
            <p className="mt-3 text-xs text-slate-500">
              Set up your other environments later in <Link className="underline" href={`/apps/${appId}/settings#ai-setup`}>Setup</Link>.
            </p>
          )}
        </Card>
      ) : (
        <>
        {!runner.online && (
          <Alert kind="info" title="The AI runner is not running">
            You can start a run now; it waits until the runner picks it up. In a second terminal in the <code>kairos-tester</code> folder run{" "}
            <code className="rounded bg-white px-1">npm run runner</code> and leave it open.
          </Alert>
        )}
        <StartRun
          appId={appId}
          environments={ready.map((e) => ({ id: e.id, name: e.name, disposable: e.disposable }))}
          sections={sections}
          defaultBuild={lastCycle?.buildLabel ?? ""}
          resumable={resumable}
        />
        </>
      )}

      {runs.length > 0 && (
        <Card title="Recent runs">
          <ul className="divide-y divide-slate-100">
            {runs.map((r) => {
              const left = r.items.filter((i) => i.status === "QUEUED" || i.status === "RUNNING").length;
              const needs = r.items.filter((i) => i.status === "NEEDS_HUMAN").length;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link className="font-medium text-teal-700 hover:underline" href={`/apps/${appId}/run/${r.id}`}>{r.cycle.name}</Link>
                  <span className="text-xs text-slate-500">
                    {r.items.length} cases · {r.status === "RUNNING" ? `${left} to go` : r.status.toLowerCase()}
                    {needs ? ` · ${needs} need you` : ""} · {formatDateTime(r.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
