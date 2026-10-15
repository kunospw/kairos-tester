// Spreadsheet import parsing: file -> sheet tables -> mapped, validated rows.
// Pure functions (no database). The DB commit lives in src/server/import-service.ts.

import ExcelJS from "exceljs";
import Papa from "papaparse";
import { z } from "zod";
import { parseOutcome, parsePriority, OUTCOME_LABEL, type OutcomeValue, type PriorityValue } from "@/lib/domain";
import { toIsoDate, type DateOrder } from "@/lib/dates";
import { IMPORT_FIELDS, type ColumnMapping, type ImportField, type ImportSummary } from "@/lib/import/fields";

export { IMPORT_FIELDS, IMPORT_FIELD_LABEL, REQUIRED_FIELDS } from "@/lib/import/fields";
export type { ColumnMapping, ImportField, ImportSummary } from "@/lib/import/fields";

export type CellValue = string | number | boolean | Date | null;

export interface SheetTable {
  name: string;
  headerRowNumber: number;
  headers: string[];
  rows: { rowNumber: number; cells: CellValue[] }[];
}

const HEADER_ALIASES: Record<ImportField, string[]> = {
  externalId: ["id", "case id", "test id", "test case id", "external id", "ref"],
  section: ["section", "module", "area", "feature"],
  role: ["role", "role (sign in as)", "sign in as", "user role", "persona"],
  environment: ["env", "environment"],
  title: ["test case", "title", "test case title", "scenario", "name", "summary"],
  preconditions: ["preconditions", "precondition", "pre-conditions", "prerequisites", "setup"],
  steps: ["steps", "test steps", "procedure", "actions"],
  expectedResult: ["expected result", "expected", "expected results", "expected outcome"],
  testData: ["test data", "data"],
  priority: ["priority", "severity"],
  result: ["result", "status", "outcome"],
  testedBy: ["tested by", "tester", "executed by"],
  date: ["date", "date tested", "tested on", "execution date"],
  notes: ["notes / actual", "notes", "actual", "actual result", "comments", "remarks"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Validates a submitted column mapping. Partial: only matched fields are listed. */
export const columnMappingSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(0).nullable());

// ------------------------------------------------------------------ reading

function cellToValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      const r = (v as ExcelJS.CellFormulaValue).result;
      if (r === undefined || r === null) return null;
      if (r instanceof Date || typeof r !== "object") return r as CellValue;
      return null; // formula error result
    }
    if ("text" in v && "hyperlink" in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? "");
    if ("error" in v) return null;
  }
  return String(v);
}

function isBlank(c: CellValue) {
  return c === null || (typeof c === "string" && c.trim() === "");
}

function tableFromRows(name: string, raw: { rowNumber: number; cells: CellValue[] }[]): SheetTable | null {
  const headerIdx = raw.findIndex((r) => r.cells.some((c) => !isBlank(c)));
  if (headerIdx < 0) return null;
  const headerRow = raw[headerIdx];
  const headers = headerRow.cells.map((c) => (c === null ? "" : String(c).trim()));
  while (headers.length && headers[headers.length - 1] === "") headers.pop();
  const rows = raw
    .slice(headerIdx + 1)
    .map((r) => ({ rowNumber: r.rowNumber, cells: headers.map((_, i) => r.cells[i] ?? null) }));
  return { name, headerRowNumber: headerRow.rowNumber, headers, rows };
}

export async function readXlsx(buffer: ArrayBuffer | Buffer): Promise<SheetTable[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings expect a Node Buffer
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const tables: SheetTable[] = [];
  wb.eachSheet((ws) => {
    const raw: { rowNumber: number; cells: CellValue[] }[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: CellValue[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellToValue(row.getCell(c).value));
      raw.push({ rowNumber, cells });
    });
    const t = tableFromRows(ws.name, raw);
    if (t) tables.push(t);
  });
  return tables;
}

export function readCsv(text: string, name = "CSV"): SheetTable[] {
  const clean = text.replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: false });
  const raw = parsed.data.map((cells, i) => ({
    rowNumber: i + 1,
    cells: cells.map((c) => (c === "" ? null : c)) as CellValue[],
  }));
  const t = tableFromRows(name, raw);
  return t ? [t] : [];
}

// ------------------------------------------------------------------ mapping

export function autoMap(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  // exact alias matches first, so "Notes / actual" doesn't steal "Actual" etc.
  for (const field of IMPORT_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && HEADER_ALIASES[field].includes(norm(h)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

// ------------------------------------------------------------------ parsing

export interface NormalizedCase {
  externalId: string;
  section: string | null;
  role: string | null;
  environment: string | null;
  title: string;
  preconditions: string | null;
  stepsText: string | null;
  expectedResult: string | null;
  testData: string | null;
  priority: PriorityValue;
  outcome: OutcomeValue;
  testedBy: string | null;
  executedOn: string | null; // YYYY-MM-DD
  notes: string | null;
}

export interface ParsedSectionRow {
  kind: "section";
  rowNumber: number;
  name: string;
}

export interface ParsedCaseRow {
  kind: "case";
  rowNumber: number;
  data: NormalizedCase;
  /** Original cell text keyed by source header, for provenance. */
  raw: Record<string, string | null>;
  errors: string[];
  warnings: string[];
  /** Imported Pass whose notes indicate parts were not tested. */
  incompleteCoverage: boolean;
}

export type ParsedRow = ParsedSectionRow | ParsedCaseRow;

export interface ParseOptions {
  dateOrder?: DateOrder;
}

export interface ParsedImport {
  sheetName: string;
  rows: ParsedRow[];
  sections: string[];
  summary: ImportSummary;
}


const INCOMPLETE_PATTERNS = [
  /\bpartial(ly)?\b/i,
  /\bnot (yet )?(tested|checked|verified|covered)\b/i,
  /\buntested\b/i,
  /\b(was|were) not (tested|checked)\b/i,
  /\bdid not (test|check|verify)\b/i,
  /\bonly the .{1,60} (was|were) tested\b/i,
];

/** Deterministic rule: does a note say part of the case was not tested? */
export function notesIndicateIncompleteTesting(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return INCOMPLETE_PATTERNS.some((p) => p.test(notes));
}

function cellText(c: CellValue): string | null {
  if (c === null) return null;
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  const s = String(c);
  return s.trim() === "" ? null : s;
}

function emptyOutcomeCounts(): Record<OutcomeValue, number> {
  return { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_RUN: 0, NOT_APPLICABLE: 0 };
}

export function parseTable(table: SheetTable, mapping: ColumnMapping, options: ParseOptions = {}): ParsedImport {
  const dateOrder = options.dateOrder ?? "DMY";
  const rows: ParsedRow[] = [];
  const sections: string[] = [];
  let currentSection: string | null = null;
  const seenIds = new Map<string, number>();

  const get = (cells: CellValue[], field: ImportField): CellValue => {
    const idx = mapping[field];
    return idx === null || idx === undefined ? null : (cells[idx] ?? null);
  };
  const text = (cells: CellValue[], field: ImportField) => {
    const v = cellText(get(cells, field));
    return v === null ? null : v.replace(/\r\n/g, "\n").trim() || null;
  };

  for (const { rowNumber, cells } of table.rows) {
    const nonBlank = cells.filter((c) => !isBlank(c));
    if (nonBlank.length === 0) continue;

    // Section heading: a single filled cell and no title.
    if (nonBlank.length === 1 && text(cells, "title") === null) {
      const name = String(nonBlank[0]).trim();
      currentSection = name;
      sections.push(name);
      rows.push({ kind: "section", rowNumber, name });
      continue;
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const externalId = (text(cells, "externalId") ?? "").trim();
    const title = text(cells, "title") ?? "";
    if (!externalId) errors.push("Missing case ID.");
    if (!title) errors.push("Missing test case title.");

    const rawResult = get(cells, "result");
    const outcome = parseOutcome(rawResult);
    if (outcome === null) {
      errors.push(
        `Unsupported result "${String(rawResult)}". Use one of: ${Object.values(OUTCOME_LABEL).join(", ")}.`,
      );
    }
    const rawPriority = get(cells, "priority");
    const priority = parsePriority(rawPriority);
    if (priority === null) errors.push(`Unsupported priority "${String(rawPriority)}". Use High, Med/Medium or Low.`);

    const rawDate = get(cells, "date");
    const iso = toIsoDate(rawDate, dateOrder);
    if (iso === null) errors.push(`Unrecognised date "${String(rawDate)}".`);

    const ownSection = text(cells, "section");
    const section = ownSection ?? currentSection;

    if (externalId) {
      const first = seenIds.get(externalId.toLowerCase());
      if (first !== undefined) errors.push(`Duplicate case ID in this file (first seen on row ${first}).`);
      else seenIds.set(externalId.toLowerCase(), rowNumber);
    }

    const notes = text(cells, "notes");
    const testedBy = text(cells, "testedBy");
    const completed = outcome !== null && outcome !== "NOT_RUN";
    if (completed && !iso) warnings.push("Completed result has no date; execution date will be unknown.");
    if (completed && !testedBy) warnings.push("Completed result has no tester name.");
    if (outcome === "NOT_RUN" && (iso || testedBy)) {
      warnings.push("Marked Not run but has a tester/date; no execution attempt will be created.");
    }
    if ((outcome === "FAIL" || outcome === "BLOCKED") && !notes) {
      warnings.push("Fail/Blocked result has no notes explaining why.");
    }
    if (!text(cells, "expectedResult")) warnings.push("No expected result.");

    const incompleteCoverage = outcome === "PASS" && notesIndicateIncompleteTesting(notes);
    if (incompleteCoverage) {
      warnings.push("Pass, but notes indicate parts were not tested. Will be flagged: incomplete coverage requiring review.");
    }

    const raw: Record<string, string | null> = {};
    table.headers.forEach((h, i) => {
      raw[h || `Column ${i + 1}`] = cellText(cells[i] ?? null);
    });

    rows.push({
      kind: "case",
      rowNumber,
      data: {
        externalId,
        section,
        role: text(cells, "role"),
        environment: text(cells, "environment"),
        title,
        preconditions: text(cells, "preconditions"),
        stepsText: text(cells, "steps"),
        expectedResult: text(cells, "expectedResult"),
        testData: text(cells, "testData"),
        priority: priority ?? "UNSET",
        outcome: outcome ?? "NOT_RUN",
        testedBy,
        executedOn: iso ?? null,
        notes,
      },
      raw,
      errors,
      warnings,
      incompleteCoverage,
    });
  }

  return { sheetName: table.name, rows, sections, summary: summarize(rows, sections) };
}

export function summarize(rows: ParsedRow[], sections: string[]): ImportSummary {
  const caseRows = rows.filter((r): r is ParsedCaseRow => r.kind === "case");
  const valid = caseRows.filter((r) => r.errors.length === 0);
  const byOutcome = emptyOutcomeCounts();
  const sectionMap = new Map<string, { cases: number; byOutcome: Record<OutcomeValue, number> }>();
  for (const r of valid) {
    byOutcome[r.data.outcome]++;
    const key = r.data.section ?? "(no section)";
    if (!sectionMap.has(key)) sectionMap.set(key, { cases: 0, byOutcome: emptyOutcomeCounts() });
    const s = sectionMap.get(key)!;
    s.cases++;
    s.byOutcome[r.data.outcome]++;
  }
  return {
    totalCases: caseRows.length,
    validCases: valid.length,
    errorRows: caseRows.length - valid.length,
    warningRows: caseRows.filter((r) => r.warnings.length > 0).length,
    sections: sections.length,
    byOutcome,
    bySection: [...sectionMap.entries()].map(([section, v]) => ({ section, ...v })),
    incompleteCoverage: valid.filter((r) => r.incompleteCoverage).length,
  };
}

// ------------------------------------------------------------------ template

export const CSV_TEMPLATE_HEADERS = [
  "ID",
  "Section",
  "Role (sign in as)",
  "Env",
  "Test case",
  "Preconditions",
  "Steps",
  "Expected result",
  "Test data",
  "Priority",
  "Result",
  "Tested by",
  "Date",
  "Notes / actual",
];

export function csvTemplate(): string {
  const example = [
    "EX-01",
    "1. Example section",
    "Admin",
    "Test",
    "Example: sign in with valid credentials",
    "An active account exists.",
    "1. Open the sign-in page.\n2. Enter valid credentials.\n3. Click Sign in.",
    "The dashboard opens and shows the user's name.",
    "",
    "High",
    "Not run",
    "",
    "",
    "",
  ];
  return Papa.unparse({ fields: CSV_TEMPLATE_HEADERS, data: [example] }, { newline: "\r\n" });
}
