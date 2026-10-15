import { z } from "zod";
import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { formJson } from "@/server/upload";
import { commitImport } from "@/server/services/import-service";
import { parseImportRequest } from "../_shared";

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), cycleId: z.string().min(1) }),
  z.object({
    kind: z.literal("new"),
    name: z.string().trim().min(1).max(200),
    buildLabel: z.string().trim().max(200).nullish(),
    environmentId: z.string().nullish(),
    scope: z.string().trim().max(4000).nullish(),
  }),
]);
const decisionsSchema = z.record(z.string(), z.enum(["skip", "update"]));

// Step 5: transactional save of cases and historical results.
export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params, user }) => {
  const { appId } = await params;
  const { form, file, type, sheetName, mapping, options, parsed } = await parseImportRequest(req);
  const target = targetSchema.parse(formJson(form, "target"));
  const decisions = decisionsSchema.parse(formJson(form, "decisions") ?? {});
  return commitImport(getPrisma(), {
    applicationId: appId,
    target,
    file: { name: file.name, type, bytes: file.bytes },
    sheetName,
    mapping,
    options,
    parsed,
    decisions,
    importedBy: user.displayName,
  });
});
