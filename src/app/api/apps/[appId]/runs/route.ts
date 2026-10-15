import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { startRun, startRunSchema } from "@/server/services/run-service";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  const run = await startRun(getPrisma(), appId, await parseJson(req, startRunSchema), user.displayName);
  return { id: run.id };
}, { agent: true });
