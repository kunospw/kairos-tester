import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { updateCycle, updateCycleSchema } from "@/server/services/cycle-service";

export const PATCH = api<{ params: Promise<{ appId: string; cycleId: string }> }>(async (req, { params }) => {
  const { appId, cycleId } = await params;
  return updateCycle(getPrisma(), appId, cycleId, await parseJson(req, updateCycleSchema));
});
