import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { createEnvironment, environmentSchema } from "@/server/services/context-service";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params }) => {
  const { appId } = await params;
  return createEnvironment(getPrisma(), appId, await parseJson(req, environmentSchema));
}, { agent: true });
