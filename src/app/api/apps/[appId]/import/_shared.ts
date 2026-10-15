import "server-only";
import { z } from "zod";
import { badRequest } from "@/server/http";
import { formJson, readForm, readUpload, importMaxBytes } from "@/server/upload";
import { readTables } from "@/server/import-files";
import { REQUIRED_FIELDS, IMPORT_FIELD_LABEL, columnMappingSchema, parseTable, type ColumnMapping } from "@/lib/import/parse";

const optionsSchema = z.object({ dateOrder: z.enum(["DMY", "MDY"]).default("DMY") });

/** Re-parse the uploaded file server-side (the browser's parse is never trusted). */
export async function parseImportRequest(req: Request) {
  const form = await readForm(req);
  const file = await readUpload(form, "file", importMaxBytes());
  const { type, tables } = await readTables(file.name, file.bytes);
  const sheetName = String(form.get("sheet") ?? tables[0].name);
  const table = tables.find((t) => t.name === sheetName);
  if (!table) throw badRequest(`Sheet "${sheetName}" not found.`);
  const mapping = columnMappingSchema.parse(formJson(form, "mapping") ?? {}) as ColumnMapping;
  for (const f of REQUIRED_FIELDS) {
    if (mapping[f] === undefined || mapping[f] === null) throw badRequest(`Map a column to "${IMPORT_FIELD_LABEL[f]}".`);
  }
  for (const [field, idx] of Object.entries(mapping)) {
    if (idx !== null && idx !== undefined && idx >= table.headers.length) throw badRequest(`Invalid column for ${field}.`);
  }
  const options = optionsSchema.parse(formJson(form, "options") ?? {});
  const parsed = parseTable(table, mapping, options);
  return { form, file, type, sheetName: type === "csv" ? null : sheetName, mapping, options, parsed };
}
