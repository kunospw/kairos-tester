import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import {
  readXlsx,
  readCsv,
  autoMap,
  parseTable,
  csvTemplate,
  notesIndicateIncompleteTesting,
  columnMappingSchema,
  type ParsedCaseRow,
} from "@/lib/import/parse";

const HEADERS = [
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

async function buildWorkbook(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Test cases");
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(r);
  wb.addWorksheet("Summary").addRow(["Cached", "=COUNTIF(A:A,1)"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cases = (rows: ReturnType<typeof parseTable>["rows"]) =>
  rows.filter((r): r is ParsedCaseRow => r.kind === "case");

describe("XLSX import parsing", () => {
  it("extracts sections without importing them as cases and preserves multiline text", async () => {
    const buf = await buildWorkbook([
      ["1. Sign-in & access"],
      [
        "SI-01",
        "K admin",
        "Demo",
        "Sign in with a code",
        "Portal running.",
        "1. Open /login.\n2. Enter email.\n3. Enter code.",
        "Signed in.",
        "High",
        "Pass",
        "dyah",
        new Date(Date.UTC(2026, 9, 12)),
        null,
      ],
      ["2. Admin"],
      ["AD-01", "K admin", "Cloud2", "Invite user", null, "1. Invite", "Invited", "Med", "Not run", null, null, null],
    ]);
    const tables = await readXlsx(buf);
    expect(tables.map((t) => t.name)).toEqual(["Test cases", "Summary"]);
    const t = tables[0];
    const parsed = parseTable(t, autoMap(t.headers));
    expect(parsed.sections).toEqual(["1. Sign-in & access", "2. Admin"]);
    const cs = cases(parsed.rows);
    expect(cs).toHaveLength(2);
    expect(cs[0].data.section).toBe("1. Sign-in & access");
    expect(cs[1].data.section).toBe("2. Admin");
    expect(cs[0].data.stepsText).toBe("1. Open /login.\n2. Enter email.\n3. Enter code.");
    expect(cs[0].data.priority).toBe("HIGH");
    expect(cs[1].data.priority).toBe("MEDIUM");
    expect(cs[0].data.outcome).toBe("PASS");
    expect(cs[1].data.outcome).toBe("NOT_RUN");
    expect(cs[0].raw["ID"]).toBe("SI-01");
  });

  it("keeps Excel date-only values from shifting across timezones", async () => {
    const buf = await buildWorkbook([
      ["X-01", "R", "Demo", "T", null, "1. s", "e", "High", "Pass", "a", new Date(Date.UTC(2026, 9, 12)), null],
      ["X-02", "R", "Demo", "T", null, "1. s", "e", "High", "Pass", "a", 46307, null], // Excel serial
      ["X-03", "R", "Demo", "T", null, "1. s", "e", "High", "Pass", "a", "02/10/2026", null],
      ["X-04", "R", "Demo", "T", null, "1. s", "e", "High", "Pass", "a", "2026-12-31", null],
    ]);
    const [t] = await readXlsx(buf);
    const cs = cases(parseTable(t, autoMap(t.headers), { dateOrder: "DMY" }).rows);
    expect(cs.map((c) => c.data.executedOn)).toEqual(["2026-10-12", "2026-10-12", "2026-10-02", "2026-12-31"]);
    const mdy = cases(parseTable(t, autoMap(t.headers), { dateOrder: "MDY" }).rows);
    expect(mdy[2].data.executedOn).toBe("2026-02-10");
  });

  it("validates required fields, outcomes, priorities and dates", async () => {
    const buf = await buildWorkbook([
      ["", "R", "Demo", "No id", null, null, "e", "High", "Pass", null, null, null],
      ["Y-01", "R", "Demo", "Bad result", null, null, "e", "High", "Maybe", null, null, null],
      ["Y-02", "R", "Demo", "Bad prio", null, null, "e", "Urgent", "Pass", null, null, null],
      ["Y-03", "R", "Demo", "Bad date", null, null, "e", "High", "Pass", "a", "not a date", null],
      ["Y-04", "R", "Demo", "", null, null, "e", "High", "Pass", null, null, "x"],
    ]);
    const [t] = await readXlsx(buf);
    const parsed = parseTable(t, autoMap(t.headers));
    const cs = cases(parsed.rows);
    expect(cs[0].errors.join(" ")).toMatch(/Missing case ID/);
    expect(cs[1].errors.join(" ")).toMatch(/Unsupported result "Maybe"/);
    expect(cs[2].errors.join(" ")).toMatch(/Unsupported priority/);
    expect(cs[3].errors.join(" ")).toMatch(/Unrecognised date/);
    expect(cs[4].errors.join(" ")).toMatch(/Missing test case title/);
    expect(parsed.summary.errorRows).toBe(5);
    expect(parsed.summary.validCases).toBe(0);
  });

  it("detects duplicate IDs within a file", async () => {
    const buf = await buildWorkbook([
      ["D-01", "R", "Demo", "First", null, null, "e", "High", "Pass", "a", null, null],
      ["d-01", "R", "Demo", "Second", null, null, "e", "High", "Fail", "a", null, "x"],
    ]);
    const [t] = await readXlsx(buf);
    const cs = cases(parseTable(t, autoMap(t.headers)).rows);
    expect(cs[0].errors).toEqual([]);
    expect(cs[1].errors.join(" ")).toMatch(/Duplicate case ID in this file \(first seen on row 2\)/);
  });

  it("flags imported Pass results whose notes reveal partial testing, without changing the result", async () => {
    const note =
      'Partial only. A wrong code (000000) is refused. Reuse of a used code and the 10-minute expiry were not tested (needs a real inbox).';
    const buf = await buildWorkbook([
      ["SI-02", "Any", "Demo", "Code works once", null, "1. a", "e", "High", "Pass", "Eileen", new Date(Date.UTC(2026, 9, 13)), note],
    ]);
    const [t] = await readXlsx(buf);
    const [c] = cases(parseTable(t, autoMap(t.headers)).rows);
    expect(c.data.outcome).toBe("PASS");
    expect(c.incompleteCoverage).toBe(true);
    expect(c.data.notes).toBe(note);
  });
});

describe("column mapping validation", () => {
  it("accepts a partial auto-mapping (regression: Zod 4 record with enum keys is exhaustive)", async () => {
    const [t] = readCsv(csvTemplate());
    const partial = { externalId: 0, title: 4 };
    expect(columnMappingSchema.parse(partial)).toEqual(partial);
    expect(columnMappingSchema.parse(autoMap(t.headers))).toEqual(autoMap(t.headers));
    expect(columnMappingSchema.safeParse({ bogus: 1 }).success).toBe(false);
    expect(columnMappingSchema.safeParse({ title: -1 }).success).toBe(false);
  });
});

describe("CSV import parsing", () => {
  it("round-trips the downloadable template", () => {
    const [t] = readCsv(csvTemplate());
    const mapping = autoMap(t.headers);
    expect(mapping.section).toBe(1);
    expect(mapping.testData).toBe(8);
    const parsed = parseTable(t, mapping);
    const [c] = cases(parsed.rows);
    expect(c.errors).toEqual([]);
    expect(c.data.section).toBe("1. Example section");
    expect(c.data.stepsText).toContain("\n2. Enter valid credentials.");
  });

  it("handles BOM, quoted multiline cells and blank results", () => {
    const csv = '﻿ID,Test case,Steps,Result\r\nC-1,"Title, with comma","1. a\n2. b",\r\n';
    const [t] = readCsv(csv);
    const [c] = cases(parseTable(t, autoMap(t.headers)).rows);
    expect(c.data.externalId).toBe("C-1");
    expect(c.data.title).toBe("Title, with comma");
    expect(c.data.stepsText).toBe("1. a\n2. b");
    expect(c.data.outcome).toBe("NOT_RUN");
  });
});

describe("incomplete-testing rule", () => {
  it("matches only notes that say something was not tested", () => {
    expect(notesIndicateIncompleteTesting("Worked. Not tested: what it shows when AI is switched off.")).toBe(true);
    expect(notesIndicateIncompleteTesting("Worked as expected.")).toBe(false);
    expect(notesIndicateIncompleteTesting(null)).toBe(false);
  });
});

// Opt-in check against the real source workbook (not committed to the repo).
const SOURCE = process.env.KT_SOURCE_WORKBOOK;
describe.skipIf(!SOURCE || !fs.existsSync(SOURCE))("real source workbook checkpoint", () => {
  it("reads the KFastTrack checklist and reports actual totals", async () => {
    const tables = await readXlsx(fs.readFileSync(SOURCE!));
    const t = tables.find((x) => x.name === "Test cases")!;
    const parsed = parseTable(t, autoMap(t.headers));
    const s = parsed.summary;
    console.log("Source workbook summary:", JSON.stringify({ cases: s.totalCases, sections: s.sections, ...s.byOutcome }));
    // Brief checkpoint at the time of writing: 123 cases, 18 sections, 73/6/4/40.
    expect(s.errorRows).toBe(0);
    expect(s.totalCases).toBe(123);
    expect(s.sections).toBe(18);
    expect(s.byOutcome).toMatchObject({ PASS: 73, FAIL: 6, BLOCKED: 4, NOT_RUN: 40, NOT_APPLICABLE: 0 });
    const si02 = cases(parsed.rows).find((c) => c.data.externalId === "SI-02")!;
    expect(si02.incompleteCoverage).toBe(true);
  });
});
