import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { createReport, newReportSchema } from "@/server/services/report-service";

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  return createReport(getPrisma(), appId, await parseJson(req, newReportSchema), user.displayName);
});
