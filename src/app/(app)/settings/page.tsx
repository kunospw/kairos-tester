import { getPrisma } from "@/server/db";
import { aiConfig } from "@/server/ai/ollama";
import { evidenceDir, maxEvidenceBytes, ALLOWED_EVIDENCE_DESCRIPTION } from "@/server/storage/evidence-storage";
import { Card, PageHeader } from "@/components/ui";
import { AiConnectionTest } from "@/components/ai-connection-test";
import { runnerStatus } from "@/server/services/attention-service";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Settings & integrations" };

export default async function SettingsPage() {
  const cfg = aiConfig();
  const db = getPrisma();
  const [evidenceCount, evidenceBytes, runner] = await Promise.all([db.evidence.count(), db.evidence.aggregate({ _sum: { sizeBytes: true } }), runnerStatus(db)]);
  return (
    <div className="space-y-5">
      <PageHeader title="Settings & integrations" subtitle="Configuration is read from .env on the server. Secrets are never shown here." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="AI: Ollama Cloud">
          <dl className="grid grid-cols-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Endpoint</dt><dd className="col-span-2 break-all">{cfg.url}</dd>
            <dt className="text-slate-500">Model</dt><dd className="col-span-2">{cfg.model}</dd>
            <dt className="text-slate-500">API key</dt><dd className="col-span-2">{cfg.keyConfigured ? "Configured (hidden)" : "Not set: AI actions disabled"}</dd>
            <dt className="text-slate-500">Timeout</dt><dd className="col-span-2">{Math.round(cfg.timeoutMs / 1000)} s</dd>
          </dl>
          <div className="mt-3"><AiConnectionTest enabled={cfg.keyConfigured} /></div>
          <p className="mt-2 text-xs text-slate-500">Change OLLAMA_API_KEY, OLLAMA_CHAT_URL and OLLAMA_MODEL in .env, then restart. Manual testing works without AI.</p>
        </Card>
        <Card title="AI runner">
          <p className="text-sm">
            Status: <strong>{runner.online ? "● Running" : "○ Not running"}</strong>
            {runner.lastSeenAt && <span className="text-xs text-slate-500"> · last seen {formatDateTime(runner.lastSeenAt)}</span>}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            The local runner drives the browser for AI test runs. Start it in a second terminal in the project folder with <code>npm run runner</code>. It only opens
            localhost addresses and never executes uploaded scripts.
          </p>
        </Card>
        <Card title="Evidence storage">
          <dl className="grid grid-cols-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Location</dt><dd className="col-span-2 break-all">{evidenceDir()}</dd>
            <dt className="text-slate-500">Files</dt><dd className="col-span-2">{evidenceCount} ({((evidenceBytes._sum.sizeBytes ?? 0) / 1048576).toFixed(1)} MB)</dd>
            <dt className="text-slate-500">Max file size</dt><dd className="col-span-2">{(maxEvidenceBytes() / 1048576).toFixed(0)} MB</dd>
            <dt className="text-slate-500">Allowed types</dt><dd className="col-span-2">{ALLOWED_EVIDENCE_DESCRIPTION}</dd>
          </dl>
          <p className="mt-2 text-xs text-slate-500">Back up this folder together with the database (see README, “Backup and restore”).</p>
        </Card>
        <Card title="Access">
          <p className="text-sm">One local tester account, configured by TESTER_USERNAME / TESTER_PASSWORD_HASH. Sessions are server-side with HttpOnly cookies.</p>
          <p className="mt-1 text-sm text-slate-600">Customer report preview is available only to the signed-in tester. Public report links and customer accounts are not part of this version.</p>
        </Card>
      </div>
    </div>
  );
}
