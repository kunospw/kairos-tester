import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { listRecipes } from "@/server/services/recipe-service";

export const GET = api<{ params: Promise<{ appId: string }> }>(async (_req, { params }) => {
  const { appId } = await params;
  return listRecipes(getPrisma(), appId);
});
