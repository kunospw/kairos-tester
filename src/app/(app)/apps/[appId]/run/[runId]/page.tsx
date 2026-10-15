import { getPrisma } from "@/server/db";
import { runView } from "@/server/services/run-service";
import { LiveRun } from "@/components/live-run";

export const metadata = { title: "Test run" };

export default async function RunDetailPage({ params }: { params: Promise<{ appId: string; runId: string }> }) {
  const { appId, runId } = await params;
  const initial = await runView(getPrisma(), appId, runId);
  return <LiveRun appId={appId} initial={JSON.parse(JSON.stringify(initial))} />;
}
