import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { createCycle, newCycleSchema } from "@/server/services/cycle-service";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  return createCycle(getPrisma(), appId, await parseJson(req, newCycleSchema), user.displayName);
}, { agent: true });
