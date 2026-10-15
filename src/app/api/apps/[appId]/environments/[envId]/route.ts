import { z } from "zod";
import { api, notFound, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { agentProfileSchema } from "@/lib/agent-profile";

const schema = z.object({
  targetUrl: z.string().trim().max(2000).nullish(),
  disposable: z.boolean().optional(),
  agentProfile: agentProfileSchema.nullable().optional(),
});

// Set up an environment for the AI runner (where the app is, how to sign in, roles, safety).
export const PATCH = api<{ params: Promise<{ appId: string; envId: string }> }>(async (req, { params }) => {
  const { appId, envId } = await params;
  const db = getPrisma();
  const env = await db.environment.findFirst({ where: { id: envId, applicationId: appId } });
  if (!env) throw notFound("Environment not found.");
  const input = await parseJson(req, schema);
  return db.environment.update({
    where: { id: envId },
    data: {
      targetUrl: input.targetUrl === undefined ? undefined : input.targetUrl || null,
      disposable: input.disposable,
      agentProfile: input.agentProfile === undefined ? undefined : ((input.agentProfile ?? null) as Prisma.InputJsonValue),
    },
  });
}, { agent: true });
