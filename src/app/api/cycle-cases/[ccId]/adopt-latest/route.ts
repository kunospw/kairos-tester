import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { adoptLatestVersion } from "@/server/services/cycle-service";

export const POST = api<{ params: Promise<{ ccId: string }> }>(async (_req, { params }) => {
  const { ccId } = await params;
  return adoptLatestVersion(getPrisma(), ccId);
});
