import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { runSimulated } from "@/server/services/simulation-service";

export const POST = api<{ params: Promise<{ ccId: string }> }>(async (_req, { params, user }) => {
  const { ccId } = await params;
  return runSimulated(getPrisma(), ccId, user.displayName);
});
