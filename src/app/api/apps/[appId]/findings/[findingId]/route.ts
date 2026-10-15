import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { findingUpdateSchema, updateFinding } from "@/server/services/context-service";

export const PATCH = api<{ params: Promise<{ appId: string; findingId: string }> }>(async (req, { params }) => {
  const { appId, findingId } = await params;
  return updateFinding(getPrisma(), appId, findingId, await parseJson(req, findingUpdateSchema));
});
