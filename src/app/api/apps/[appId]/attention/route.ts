import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { attentionCounts } from "@/server/services/attention-service";

// "Needs you" count and runner status, polled by the app navigation.
export const GET = api<{ params: Promise<{ appId: string }> }>(async (_req, { params }) => {
  const { appId } = await params;
  return attentionCounts(getPrisma(), appId);
});
