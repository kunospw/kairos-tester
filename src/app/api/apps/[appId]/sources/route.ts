import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { createSource, sourceSchema } from "@/server/services/context-service";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params }) => {
  const { appId } = await params;
  return createSource(getPrisma(), appId, await parseJson(req, sourceSchema));
});
