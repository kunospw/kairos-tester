import "server-only";
import { badRequest } from "@/server/http";
import { readCsv, readXlsx, type SheetTable } from "@/lib/import/parse";

export type ImportFileType = "xlsx" | "csv";

export function fileTypeOf(name: string, bytes: Buffer): ImportFileType {
  const lower = name.toLowerCase();
  const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (lower.endsWith(".xlsx")) {
    if (!zip) throw badRequest("This .xlsx file is not a valid Excel workbook.");
    return "xlsx";
  }
  if (lower.endsWith(".csv")) {
    if (bytes.includes(0)) throw badRequest("This .csv file contains binary data.");
    return "csv";
  }
  throw badRequest("Upload an .xlsx or .csv file. (Older .xls files: open in Excel and save as .xlsx.)");
}

export async function readTables(name: string, bytes: Buffer): Promise<{ type: ImportFileType; tables: SheetTable[] }> {
  const type = fileTypeOf(name, bytes);
  try {
    const tables = type === "xlsx" ? await readXlsx(bytes) : readCsv(new TextDecoder("utf-8").decode(bytes), name);
    if (!tables.length) throw badRequest("No data found in the file.");
    return { type, tables };
  } catch (e) {
    if (e instanceof Error && "status" in e) throw e;
    throw badRequest(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
  }
}
