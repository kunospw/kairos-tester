import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { allDashboardSummaries } from "@/server/services/dashboard-summary-service";

// Portfolio-wide version of [appId]/dashboard-summary, so an external dashboard
// (kapphelper) can sync every application in one call instead of one per app.
export const GET = api(async () => {
  const applications = await allDashboardSummaries(getPrisma());
  return { applications };
}, { agent: true });
