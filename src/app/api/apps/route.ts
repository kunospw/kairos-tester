import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { applicationSchema, createApplication } from "@/server/services/context-service";

export const POST = api(async (req) => {
  const input = await parseJson(req, applicationSchema);
  return createApplication(getPrisma(), input);
});
