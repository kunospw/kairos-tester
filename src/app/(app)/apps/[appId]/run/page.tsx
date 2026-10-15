import Link from "next/link";
import { getPrisma } from "@/server/db";
import { aiConfig } from "@/server/ai/ollama";
import { parseProfile } from "@/lib/agent-profile";
import { listRuns } from "@/server/services/run-service";
import { runnerStatus } from "@/server/services/attention-service";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
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
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Run tests" subtitle="The AI works through your test cases in the browser and only asks you for what it can't do itself." />

      {!aiConfig().keyConfigured && (
        <div className="mb-6"><Alert kind="warning" title="AI is not configured">Add OLLAMA_API_KEY to .env and restart Kairos Tester.</Alert></div>
      )}

      {cases.length === 0 ? (
        <EmptyState title="Import your test cases first" action={<Link className="btn-primary" href={`/apps/${appId}/cases/import`}>Import checklist</Link>}>
          The AI runs the cases in your checklist. Nothing to run yet.
        </EmptyState>
      ) : envs.length === 0 ? (
        <EmptyState title="Add the environment you test against" action={<Link className="btn-primary" href={`/apps/${appId}/settings#environments`}>Add environment</Link>}>
          For example “Demo (local)” at http://localhost:3000.
        </EmptyState>
      ) : ready.length === 0 ? (
        <Card title={`One-time setup: how the AI uses ${envs[0].name}`}>
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
            <div className="mb-6">
              <Alert kind="info" title="The AI runner is stopped">
                Runs wait until it starts. In a second terminal in the <code>kairos-tester</code> folder run <code className="rounded bg-white px-1 ring-1 ring-slate-200">npm run runner</code> and leave it open.
              </Alert>
            </div>
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
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-semibold">Recent runs</h2>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {runs.map((r) => {
              const left = r.items.filter((i) => i.status === "QUEUED" || i.status === "RUNNING").length;
              const needs = r.items.filter((i) => i.status === "NEEDS_HUMAN").length;
              return (
                <li key={r.id}>
                  <Link className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-slate-50" href={`/apps/${appId}/run/${r.id}`}>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{r.cycle.name}</span>
                    <span className="text-slate-600 tabular-nums">
                      {r.status === "RUNNING" ? `${r.items.length - left} of ${r.items.length} done` : r.status === "COMPLETED" ? `${r.items.length} cases, finished` : "cancelled"}
                    </span>
                    {needs > 0 && <span className="font-medium text-ink-900 tabular-nums">{needs} need you</span>}
                    <span className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
