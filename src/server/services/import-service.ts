// Import commit: saves parsed cases and historical results in one transaction.
//
// Rules:
// - New external IDs create a TestCase + version 1 (source IMPORT).
// - Existing external IDs are SKIPPED unless the reviewer explicitly chose
//   "update" for that ID; an update creates a new version (never edits one).
// - Completed outcomes become imported historical attempts (method UNKNOWN,
//   build unknown, no step outcomes/evidence). Not run rows get no attempt.
// - A re-imported identical result is not duplicated; a different result is
//   appended as a new attempt so earlier history is never overwritten.
// - Every row is stored verbatim in ImportRow for provenance.

import { createHash } from "node:crypto";
import type { Db, Tx } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ParsedImport, ParsedCaseRow, NormalizedCase, ColumnMapping } from "@/lib/import/parse";
import { isoDateToDbDate, dbDateToIso } from "@/lib/dates";
import { badRequest, notFound } from "@/server/errors";
import { changedFields, insertVersion, type CaseContent } from "@/server/services/case-content";

export type DuplicateDecision = "skip" | "update";

export interface PreviewRow {
  rowNumber: number;
  externalId: string;
  title: string;
  section: string | null;
  outcome: string;
  executedOn: string | null;
  testedBy: string | null;
  errors: string[];
  warnings: string[];
  incompleteCoverage: boolean;
  existing: null | {
    testCaseId: string;
    currentVersion: number;
    changedFields: string[];
    resultInTargetCycle: string | null;
  };
}

export function contentFromRow(d: NormalizedCase): CaseContent {
  return {
    title: d.title,
    section: d.section,
    role: d.role,
    environment: d.environment,
    preconditions: d.preconditions,
    stepsText: d.stepsText,
    expectedResult: d.expectedResult,
    testData: d.testData,
    priority: d.priority,
    executionMode: "UNKNOWN",
    categories: [],
    dependsOn: null,
  };
}

const IMPORT_COMPARE_FIELDS = [
  "title",
  "section",
  "role",
  "environment",
  "preconditions",
  "stepsText",
  "expectedResult",
  "testData",
  "priority",
] as const;

async function loadExisting(db: Db | Tx, applicationId: string) {
  const cases = await db.testCase.findMany({
    where: { applicationId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  return new Map(cases.map((c) => [c.externalId.toLowerCase(), c]));
}

export async function previewImport(
  db: Db,
  applicationId: string,
  cycleId: string | null,
  parsed: ParsedImport,
): Promise<PreviewRow[]> {
  const existing = await loadExisting(db, applicationId);
  const cycleResults = new Map<string, string>();
  if (cycleId) {
    const ccs = await db.cycleCase.findMany({
      where: { cycleId },
      include: { attempts: { where: { status: "COMPLETED" }, orderBy: { attemptNumber: "desc" }, take: 1 } },
    });
    for (const cc of ccs) cycleResults.set(cc.testCaseId, cc.attempts[0]?.outcome ?? "NOT_RUN");
  }
  return parsed.rows
    .filter((r): r is ParsedCaseRow => r.kind === "case")
    .map((r) => {
      const ex = r.data.externalId ? existing.get(r.data.externalId.toLowerCase()) : undefined;
      const v = ex?.versions[0];
      return {
        rowNumber: r.rowNumber,
        externalId: r.data.externalId,
        title: r.data.title,
        section: r.data.section,
        outcome: r.data.outcome,
        executedOn: r.data.executedOn,
        testedBy: r.data.testedBy,
        errors: r.errors,
        warnings: r.warnings,
        incompleteCoverage: r.incompleteCoverage,
        existing:
          ex && v
            ? {
                testCaseId: ex.id,
                currentVersion: v.versionNumber,
                changedFields: changedFields(v, contentFromRow(r.data), IMPORT_COMPARE_FIELDS),
                resultInTargetCycle: cycleResults.get(ex.id) ?? null,
              }
            : null,
      };
    });
}

export interface CommitInput {
  applicationId: string;
  target:
    | { kind: "existing"; cycleId: string }
    | { kind: "new"; name: string; buildLabel?: string | null; environmentId?: string | null; scope?: string | null };
  file: { name: string; type: "xlsx" | "csv"; bytes: Buffer };
  sheetName: string | null;
  mapping: ColumnMapping;
  options: { dateOrder: "DMY" | "MDY" };
  parsed: ParsedImport;
  /** Explicit decisions for external IDs that already exist (default: skip). */
  decisions: Record<string, DuplicateDecision>;
  importedBy: string;
}

export interface CommitStats {
  sections: number;
  casesCreated: number;
  casesUpdated: number;
  casesUnchanged: number;
  casesSkipped: number;
  errorRows: number;
  attemptsCreated: number;
  resultsAlreadyRecorded: number;
  notRun: number;
  incompleteCoverageFlags: number;
}

export async function commitImport(db: Db, input: CommitInput) {
  const app = await db.application.findUnique({ where: { id: input.applicationId } });
  if (!app) throw notFound("Application not found.");
  const fileSha256 = createHash("sha256").update(input.file.bytes).digest("hex");

  return db.$transaction(
    async (tx) => {
      // ---- destination cycle
      let cycleId: string;
      if (input.target.kind === "existing") {
        const cycle = await tx.testCycle.findFirst({
          where: { id: input.target.cycleId, applicationId: app.id },
        });
        if (!cycle) throw badRequest("Destination cycle does not belong to this application.");
        if (cycle.kind === "SIMULATION") throw badRequest("Cannot import real results into a simulation cycle.");
        cycleId = cycle.id;
      } else {
        if (input.target.environmentId) {
          const env = await tx.environment.findFirst({ where: { id: input.target.environmentId, applicationId: app.id } });
          if (!env) throw badRequest("Environment does not belong to this application.");
        }
        const dup = await tx.testCycle.findFirst({ where: { applicationId: app.id, name: input.target.name } });
        if (dup) throw badRequest(`A cycle named "${input.target.name}" already exists.`);
        const cycle = await tx.testCycle.create({
          data: {
            applicationId: app.id,
            name: input.target.name,
            kind: "HISTORICAL_IMPORT",
            buildLabel: input.target.buildLabel || null,
            environmentId: input.target.environmentId || null,
            scope: input.target.scope || `Imported from ${input.file.name}`,
            createdBy: input.importedBy,
          },
        });
        cycleId = cycle.id;
      }

      // ---- provenance
      const source = await tx.sourceReference.create({
        data: {
          applicationId: app.id,
          kind: "WORKBOOK",
          title: input.file.name,
          location: input.sheetName ? `Sheet "${input.sheetName}"` : null,
          notes: `Imported ${new Date().toISOString()} by ${input.importedBy}. SHA-256 ${fileSha256.slice(0, 16)}…`,
        },
      });
      const batch = await tx.importBatch.create({
        data: {
          applicationId: app.id,
          cycleId,
          sourceReferenceId: source.id,
          fileName: input.file.name,
          fileSha256,
          fileType: input.file.type,
          sheetName: input.sheetName,
          mapping: input.mapping as Prisma.InputJsonValue,
          options: { ...input.options, decisions: input.decisions } as Prisma.InputJsonValue,
          stats: {},
          importedBy: input.importedBy,
        },
      });

      const existing = await loadExisting(tx, app.id);
      const stats: CommitStats = {
        sections: 0,
        casesCreated: 0,
        casesUpdated: 0,
        casesUnchanged: 0,
        casesSkipped: 0,
        errorRows: 0,
        attemptsCreated: 0,
        resultsAlreadyRecorded: 0,
        notRun: 0,
        incompleteCoverageFlags: 0,
      };
      let sortOrder = await tx.cycleCase.count({ where: { cycleId } });

      for (const row of input.parsed.rows) {
        if (row.kind === "section") {
          stats.sections++;
          await tx.importRow.create({
            data: { batchId: batch.id, rowNumber: row.rowNumber, section: row.name, raw: { section: row.name }, action: "SECTION" },
          });
          continue;
        }
        const d = row.data;
        if (row.errors.length) {
          stats.errorRows++;
          await tx.importRow.create({
            data: {
              batchId: batch.id,
              rowNumber: row.rowNumber,
              section: d.section,
              raw: row.raw as Prisma.InputJsonValue,
              action: "ERROR",
              message: row.errors.join(" "),
            },
          });
          continue;
        }

        const key = d.externalId.toLowerCase();
        const ex = existing.get(key);
        const content = contentFromRow(d);
        let testCaseId: string;
        let versionId: string;
        let importRowId: string;

        if (!ex) {
          const tc = await tx.testCase.create({
            data: { applicationId: app.id, externalId: d.externalId, origin: "IMPORT", createdBy: input.importedBy },
          });
          const ir = await tx.importRow.create({
            data: {
              batchId: batch.id,
              rowNumber: row.rowNumber,
              section: d.section,
              raw: row.raw as Prisma.InputJsonValue,
              action: "CREATED",
              testCaseId: tc.id,
            },
          });
          const v = await insertVersion(tx, tc.id, content, {
            source: "IMPORT",
            createdBy: input.importedBy,
            changeNote: `Imported from ${input.file.name} row ${row.rowNumber}`,
            importRowId: ir.id,
          });
          existing.set(key, { ...tc, versions: [v] });
          importRowId = ir.id;
          testCaseId = tc.id;
          versionId = v.id;
          stats.casesCreated++;
        } else {
          const decision = input.decisions[d.externalId] ?? input.decisions[key] ?? "skip";
          if (decision === "skip") {
            stats.casesSkipped++;
            await tx.importRow.create({
              data: {
                batchId: batch.id,
                rowNumber: row.rowNumber,
                section: d.section,
                raw: row.raw as Prisma.InputJsonValue,
                action: "SKIPPED",
                message: "Case ID already exists in this application; skipped (no case or result changes).",
                testCaseId: ex.id,
              },
            });
            continue;
          }
          const current = ex.versions[0];
          const changes = changedFields(current, content, IMPORT_COMPARE_FIELDS);
          const ir = await tx.importRow.create({
            data: {
              batchId: batch.id,
              rowNumber: row.rowNumber,
              section: d.section,
              raw: row.raw as Prisma.InputJsonValue,
              action: "UPDATED",
              message: changes.length ? `New version; changed: ${changes.join(", ")}` : "Content unchanged; existing version kept.",
              testCaseId: ex.id,
            },
          });
          testCaseId = ex.id;
          importRowId = ir.id;
          if (changes.length) {
            // Keep reviewed attributes (mode, categories, structured step flags) that the sheet does not carry.
            const v = await insertVersion(
              tx,
              ex.id,
              { ...content, executionMode: current.executionMode, categories: current.categories, dependsOn: current.dependsOn },
              {
                source: "IMPORT_UPDATE",
                createdBy: input.importedBy,
                changeNote: `Reviewed re-import from ${input.file.name} row ${row.rowNumber}; changed: ${changes.join(", ")}`,
                importRowId: ir.id,
              },
            );
            ex.versions = [v];
            versionId = v.id;
            stats.casesUpdated++;
          } else {
            versionId = current.id;
            stats.casesUnchanged++;
          }
        }

        // ---- cycle assignment & historical result
        let cc = await tx.cycleCase.findUnique({ where: { cycleId_testCaseId: { cycleId, testCaseId } } });
        if (!cc) {
          cc = await tx.cycleCase.create({
            data: { cycleId, testCaseId, caseVersionId: versionId, sortOrder: sortOrder++, importNotes: d.outcome === "NOT_RUN" ? d.notes : null },
          });
        } else if (cc.caseVersionId !== versionId) {
          cc = await tx.cycleCase.update({ where: { id: cc.id }, data: { caseVersionId: versionId } });
        }

        if (d.outcome === "NOT_RUN") {
          stats.notRun++;
          continue;
        }

        const prior = await tx.executionAttempt.findMany({
          where: { cycleCaseId: cc.id },
          orderBy: { attemptNumber: "desc" },
        });
        const same = prior.find(
          (a) =>
            a.source === "IMPORT" &&
            a.outcome === d.outcome &&
            dbDateToIso(a.executedOn) === d.executedOn &&
            (a.tester ?? null) === d.testedBy &&
            (a.remarks ?? null) === d.notes,
        );
        if (same) {
          stats.resultsAlreadyRecorded++;
          continue;
        }
        const attempt = await tx.executionAttempt.create({
          data: {
            cycleCaseId: cc.id,
            caseVersionId: versionId,
            attemptNumber: (prior[0]?.attemptNumber ?? 0) + 1,
            status: "COMPLETED",
            outcome: d.outcome,
            remarks: d.notes,
            tester: d.testedBy,
            executionMethod: "UNKNOWN",
            buildLabel: null,
            source: "IMPORT",
            executedOn: d.executedOn ? isoDateToDbDate(d.executedOn) : null,
            importRowId,
          },
        });
        stats.attemptsCreated++;

        if (row.incompleteCoverage) {
          await tx.finding.create({
            data: {
              applicationId: app.id,
              testCaseId,
              cycleCaseId: cc.id,
              attemptId: attempt.id,
              type: "INCOMPLETE_TESTING",
              source: "IMPORT_RULE",
              message:
                "Imported as Pass, but the notes say parts of this case were not tested. Incomplete coverage requiring review. The imported result is preserved unchanged.",
              evidenceExcerpt: d.notes,
              createdBy: "import rule",
            },
          });
          stats.incompleteCoverageFlags++;
        }
      }

      await tx.importBatch.update({ where: { id: batch.id }, data: { stats: stats as unknown as Prisma.InputJsonValue } });
      return { batchId: batch.id, cycleId, stats };
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
}
