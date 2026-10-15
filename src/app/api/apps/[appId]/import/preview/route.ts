import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { previewImport } from "@/server/services/import-service";
import { parseImportRequest } from "../_shared";

// Step 3: parsed cases, sections, dates, outcomes, errors and duplicates. Writes nothing.
export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params }) => {
  const { appId } = await params;
  const { form, parsed } = await parseImportRequest(req);
  const cycleId = (form.get("cycleId") as string | null) || null;
  const rows = await previewImport(getPrisma(), appId, cycleId, parsed);
  return { summary: parsed.summary, sections: parsed.sections, rows };
});
