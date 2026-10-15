import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { planRun, startRunSchema } from "@/server/services/run-service";

// Preview: which cases the AI will run, which need a person, which are not allowed.
export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params }) => {
  const { appId } = await params;
  const { cases, profile } = await planRun(getPrisma(), appId, await parseJson(req, startRunSchema));
  return { ready: Boolean(profile), cases };
});
