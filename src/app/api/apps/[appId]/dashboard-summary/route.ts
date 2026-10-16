import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { dashboardSummary } from "@/server/services/dashboard-summary-service";

// Read-only, for an external dashboard (kapphelper) to poll. Agent-token or session.
export const GET = api<{ params: Promise<{ appId: string }> }>(async (_req, { params }) => {
  const { appId } = await params;
  return dashboardSummary(getPrisma(), appId);
}, { agent: true });
