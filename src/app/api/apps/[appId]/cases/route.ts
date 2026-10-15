import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { createCase, newCaseSchema } from "@/server/services/case-service";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  return createCase(getPrisma(), appId, await parseJson(req, newCaseSchema), user.displayName);
});
