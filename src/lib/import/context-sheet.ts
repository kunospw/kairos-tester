// Turns an instructions sheet (e.g. "How to use") into candidate context
// entries. Everything produced here is UNREVIEWED: statements in a workbook's
// guidance are not treated as verified current requirements.

import type { SheetTable, CellValue } from "@/lib/import/parse";

export interface ContextCandidate {
  title: string;
  body: string;
  category:
    | "ROLES_PERMISSIONS"
    | "BUSINESS_WORKFLOWS"
    | "BUSINESS_RULES"
    | "TECHNICAL_DETAILS"
    | "REQUIREMENTS_REFERENCES"
    | "CONSTRAINTS_GAPS";
  sourceRows: string;
}

const text = (c: CellValue) => (c === null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());

export function guessCategory(title: string): ContextCandidate["category"] {
  const t = title.toLowerCase();
  if (/gap|limitation|constraint|out of scope|not built/.test(t)) return "CONSTRAINTS_GAPS";
  if (/account|role|permission|user/.test(t)) return "ROLES_PERMISSIONS";
  if (/setup|environment|cloud|technical|config|file/.test(t)) return "TECHNICAL_DETAILS";
  if (/priority|result key|rule/.test(t)) return "BUSINESS_RULES";
  if (/how to run|workflow|process|steps/.test(t)) return "BUSINESS_WORKFLOWS";
  return "REQUIREMENTS_REFERENCES";
}

export function contextFromSheet(table: SheetTable): ContextCandidate[] {
  const all = [
    { rowNumber: table.headerRowNumber, cells: table.headers as CellValue[] },
    ...table.rows,
  ];
  const blocks: { title: string; lines: string[]; first: number; last: number }[] = [];
  let current: (typeof blocks)[number] | null = null;

  for (let i = 0; i < all.length; i++) {
    const cells = all[i].cells.map(text);
    const filled = cells.filter(Boolean);
    if (!filled.length) continue;
    const next = all.slice(i + 1).find((r) => r.cells.some((c) => text(c)));
    const isHeading =
      filled.length === 1 && cells[0] && cells[0].length <= 80 && !/[.:]$/.test(cells[0]) && Boolean(next);
    if (isHeading && (!current || current.lines.length > 0)) {
      current = { title: cells[0], lines: [], first: all[i].rowNumber, last: all[i].rowNumber };
      blocks.push(current);
      continue;
    }
    if (!current) {
      current = { title: table.name, lines: [], first: all[i].rowNumber, last: all[i].rowNumber };
      blocks.push(current);
    }
    current.lines.push(filled.length === 1 ? filled[0] : filled.join(" | "));
    current.last = all[i].rowNumber;
  }

  return blocks
    .filter((b) => b.lines.length)
    .map((b) => ({
      title: b.title,
      body: b.lines.join("\n"),
      category: guessCategory(b.title),
      sourceRows: b.first === b.last ? `row ${b.first}` : `rows ${b.first}-${b.last}`,
    }));
}
