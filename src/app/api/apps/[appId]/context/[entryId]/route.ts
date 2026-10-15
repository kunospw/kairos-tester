import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { contextEntrySchema, deleteContextEntry, updateContextEntry } from "@/server/services/context-service";

type Ctx = { params: Promise<{ appId: string; entryId: string }> };

export const PATCH = api<Ctx>(async (req, { params, user }) => {
  const { appId, entryId } = await params;
  return updateContextEntry(getPrisma(), appId, entryId, await parseJson(req, contextEntrySchema.partial()), user.displayName);
});

export const DELETE = api<Ctx>(async (_req, { params }) => {
  const { appId, entryId } = await params;
  await deleteContextEntry(getPrisma(), appId, entryId);
  return { ok: true };
});
