import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { disableRecipe } from "@/server/services/recipe-service";

export const POST = api<{ params: Promise<{ appId: string; recipeId: string }> }>(async (_req, { params, user }) => {
  const { appId, recipeId } = await params;
  return disableRecipe(getPrisma(), appId, recipeId, user.displayName);
});
