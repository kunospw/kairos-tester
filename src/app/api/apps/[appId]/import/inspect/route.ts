import { api } from "@/server/http";
import { readForm, readUpload, importMaxBytes } from "@/server/upload";
import { readTables } from "@/server/import-files";
import { autoMap } from "@/lib/import/parse";

// Step 1: list sheets, headers and a suggested column mapping.
export const POST = api(async (req) => {
  const form = await readForm(req);
  const file = await readUpload(form, "file", importMaxBytes());
  const { type, tables } = await readTables(file.name, file.bytes);
  return {
    fileName: file.name,
    fileType: type,
    sheets: tables.map((t) => ({
      name: t.name,
      headers: t.headers,
      rowCount: t.rows.length,
      suggestedMapping: autoMap(t.headers),
    })),
  };
});
