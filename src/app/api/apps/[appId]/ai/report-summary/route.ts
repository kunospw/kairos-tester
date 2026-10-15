import { z } from "zod";
import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { generateReportSummary, prepareReportSummary } from "@/server/services/ai-service";
import { withAi } from "../_errors";

const schema = z.object({ reportId: z.string() });

export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  const { reportId } = await parseJson(req, schema);
  if (new URL(req.url).searchParams.get("preview") === "1") {
    const { prepared } = await prepareReportSummary(getPrisma(), appId, reportId);
    return prepared;
  }
  return withAi(() => generateReportSummary(getPrisma(), appId, reportId, user.displayName));
});
