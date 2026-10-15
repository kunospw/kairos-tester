import { api, notFound } from "@/server/http";
import { getPrisma } from "@/server/db";
import { reportCsv } from "@/server/services/report-service";

export const GET = api<{ params: Promise<{ appId: string; reportId: string }> }>(async (_req, { params }) => {
  const { appId, reportId } = await params;
  const report = await getPrisma().reportSnapshot.findFirst({ where: { id: reportId, cycle: { applicationId: appId } } });
  if (!report) throw notFound("Report not found.");
  const safeTitle = report.title.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "report";
  return new Response(reportCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeTitle}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
});
