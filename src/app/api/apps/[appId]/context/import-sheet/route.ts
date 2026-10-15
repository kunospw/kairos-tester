import { api, badRequest } from "@/server/http";
import { getPrisma } from "@/server/db";
import { readForm, readUpload, importMaxBytes } from "@/server/upload";
import { readTables } from "@/server/import-files";
import { contextFromSheet } from "@/lib/import/context-sheet";
import { importContextCandidates } from "@/server/services/context-service";

// POST multipart { file, sheet, confirm? } -> candidates preview, or saves them as UNREVIEWED when confirm=1.
export const POST = api<{ params: Promise<{ appId: string }> }>(async (req, { params }) => {
  const { appId } = await params;
  const form = await readForm(req);
  const file = await readUpload(form, "file", importMaxBytes());
  const { tables } = await readTables(file.name, file.bytes);
  const sheetName = String(form.get("sheet") ?? "");
  const table = tables.find((t) => t.name === sheetName);
  if (!table) throw badRequest(`Sheet "${sheetName}" not found. Available: ${tables.map((t) => t.name).join(", ")}`);
  const candidates = contextFromSheet(table);
  if (form.get("confirm") !== "1") return { candidates };
  return importContextCandidates(getPrisma(), appId, { name: file.name, sheetName }, candidates);
});
