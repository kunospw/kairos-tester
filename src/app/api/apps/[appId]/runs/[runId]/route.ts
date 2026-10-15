import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { runView } from "@/server/services/run-service";

// Live status, polled by the run screen. ?focus=<itemId> pins the step log to one case.
export const GET = api<{ params: Promise<{ appId: string; runId: string }> }>(async (req, { params }) => {
  const { appId, runId } = await params;
  return runView(getPrisma(), appId, runId, new URL(req.url).searchParams.get("focus"));
}, { agent: true });
