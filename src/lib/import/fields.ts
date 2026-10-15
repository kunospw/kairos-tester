// Import field definitions shared by the server parser and client wizard.
// Keep this module free of heavy dependencies (it is bundled for the browser).
import type { OutcomeValue } from "@/lib/domain";

export const IMPORT_FIELDS = [
  "externalId",
  "section",
  "role",
  "environment",
  "title",
  "preconditions",
  "steps",
  "expectedResult",
  "testData",
  "priority",
  "result",
  "testedBy",
  "date",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, number | null>>;

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  externalId: "Case ID",
  section: "Section",
  role: "Role (sign in as)",
  environment: "Environment",
  title: "Test case title",
  preconditions: "Preconditions",
  steps: "Steps",
  expectedResult: "Expected result",
  testData: "Test data",
  priority: "Priority",
  result: "Result",
  testedBy: "Tested by",
  date: "Date tested",
  notes: "Notes / actual",
};

export const REQUIRED_FIELDS: ImportField[] = ["externalId", "title"];

export interface ImportSummary {
  totalCases: number;
  validCases: number;
  errorRows: number;
  warningRows: number;
  sections: number;
  byOutcome: Record<OutcomeValue, number>;
  bySection: { section: string; cases: number; byOutcome: Record<OutcomeValue, number> }[];
  incompleteCoverage: number;
}
