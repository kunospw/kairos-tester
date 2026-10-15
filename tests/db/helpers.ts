import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPrismaClient, type Db } from "@/server/db";
import { assertDisposableTestDb } from "./guard";
import { readXlsx, autoMap, parseTable } from "@/lib/import/parse";
import { commitImport, type DuplicateDecision } from "@/server/services/import-service";
import { LocalEvidenceStorage } from "@/server/storage/evidence-storage";

export function testDb(): Db {
  return createPrismaClient(assertDisposableTestDb());
}

/** Empty every table in the disposable test database. */
export async function resetDb(db: Db) {
  assertDisposableTestDb();
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

export const HEADERS = [
  "ID",
  "Role (sign in as)",
  "Env",
  "Test case",
  "Preconditions",
  "Steps",
  "Expected result",
  "Priority",
  "Result",
  "Tested by",
  "Date",
  "Notes / actual",
];

export const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/** A small KFastTrack-like workbook: sections, mixed outcomes, a partial-coverage Pass. */
export function sampleRows(): unknown[][] {
  return [
    ["1. Sign-in & access"],
    ["SI-01", "K admin", "Demo", "Sign in with a one-time code", "Portal running.", "1. Open /login.\n2. Enter email.\n3. Enter code.", "Signed in.", "High", "Pass", "dyah", d(2026, 10, 12), null],
    [
      "SI-02",
      "Any invited user",
      "Demo",
      "A code works once and expires",
      "Real inbox.",
      "1. Sign in.\n2. Reuse code.\n3. Wait 11 minutes.",
      "Reused and expired codes refused.",
      "High",
      "Pass",
      "Eileen",
      d(2026, 10, 13),
      "Partial only. Wrong code refused. Reuse of a used code and the 10-minute expiry were not tested (needs a real inbox).",
    ],
    ["SI-03", "Not signed in", "Demo", "Unknown email does not reveal accounts", null, "1. Request code for unknown email.", "Same screen as known email.", "Med", "Fail", "dyah", d(2026, 10, 12), "Shows a different message."],
    ["2. Admin"],
    ["AD-01", "K admin", "Cloud2", "Connect Cloud2 account", null, "1. Open Admin.", "Connected.", "High", "Blocked", "dyah", d(2026, 10, 11), "Cloud2 unavailable."],
    ["AD-02", "K admin", "Demo", "Invite a user", null, "1. Invite.", "Invite sent.", "Low", "Not run", null, null, null],
  ];
}

export async function workbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Test cases");
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function importRows(
  db: Db,
  applicationId: string,
  rows: unknown[][],
  target: Parameters<typeof commitImport>[1]["target"],
  decisions: Record<string, DuplicateDecision> = {},
) {
  const bytes = await workbookBuffer(rows);
  const [table] = await readXlsx(bytes);
  const mapping = autoMap(table.headers);
  const parsed = parseTable(table, mapping, { dateOrder: "DMY" });
  return commitImport(db, {
    applicationId,
    target,
    file: { name: "checklist.xlsx", type: "xlsx", bytes },
    sheetName: table.name,
    mapping,
    options: { dateOrder: "DMY" },
    parsed,
    decisions,
    importedBy: "test",
  });
}

export function tempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kt-evidence-"));
  return { dir, storage: new LocalEvidenceStorage(dir) };
}

// 1x1 transparent PNG
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
