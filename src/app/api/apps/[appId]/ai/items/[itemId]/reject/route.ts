import { z } from "zod";
import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { rejectItem } from "@/server/services/ai-service";

export const POST = api<{ params: Promise<{ appId: string; itemId: string }> }>(async (req, { params, user }) => {
  const { appId, itemId } = await params;
  const { note } = await parseJson(req, z.object({ note: z.string().max(2000).nullish() }));
  return rejectItem(getPrisma(), appId, itemId, note ?? null, user.displayName);
});
