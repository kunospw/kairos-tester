import { z } from "zod";
import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { saveItemEdits } from "@/server/services/ai-service";

// Save reviewer edits to a pending proposal item (the original AI output is kept separately).
export const PATCH = api<{ params: Promise<{ appId: string; itemId: string }> }>(async (req, { params }) => {
  const { appId, itemId } = await params;
  const { payload } = await parseJson(req, z.object({ payload: z.record(z.string(), z.unknown()) }));
  return saveItemEdits(getPrisma(), appId, itemId, payload);
});
