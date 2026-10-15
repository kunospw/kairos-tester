// Case content shape shared by manual edits, imports and AI proposals.
import { z } from "zod";
import { splitSteps } from "@/lib/domain";
import type { Tx } from "@/server/db";
import type { Prisma, VersionSource } from "@/generated/prisma/client";

const optText = z
  .string()
  .max(20000)
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const stepSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  required: z.boolean().default(true),
});

export const caseContentSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  section: optText,
  role: optText,
  environment: optText,
  preconditions: optText,
  stepsText: optText,
  steps: z.array(stepSchema).max(100).optional(),
  expectedResult: optText,
  testData: optText,
  priority: z.enum(["HIGH", "MEDIUM", "LOW", "UNSET"]).default("UNSET"),
  executionMode: z.enum(["UNKNOWN", "MANUAL", "AUTOMATED", "HYBRID"]).default("UNKNOWN"),
  categories: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  dependsOn: optText,
});
export type CaseContent = z.infer<typeof caseContentSchema>;

export const CONTENT_FIELDS = [
  "title",
  "section",
  "role",
  "environment",
  "preconditions",
  "stepsText",
  "expectedResult",
  "testData",
  "priority",
  "executionMode",
  "categories",
  "dependsOn",
] as const;

export function stepsFor(content: CaseContent): { text: string; required: boolean }[] {
  if (content.steps && content.steps.length) return content.steps;
  return splitSteps(content.stepsText).map((text) => ({ text, required: true }));
}

type VersionLike = Record<(typeof CONTENT_FIELDS)[number], unknown> & { steps?: unknown };

/** Names of fields whose value differs between a stored version and new content. */
export function changedFields(
  current: VersionLike,
  next: Partial<CaseContent>,
  fields: readonly (typeof CONTENT_FIELDS)[number][] = CONTENT_FIELDS,
): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!(f in next)) continue;
    const a = current[f] ?? null;
    const b = (next as Record<string, unknown>)[f] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(f);
  }
  if (next.steps && JSON.stringify(current.steps ?? []) !== JSON.stringify(next.steps)) out.push("steps");
  return out;
}

/** Insert a new immutable version. Version numbers are sequential per case. */
export async function insertVersion(
  tx: Tx,
  testCaseId: string,
  content: CaseContent,
  meta: {
    source: VersionSource;
    createdBy: string | null;
    changeNote?: string | null;
    importRowId?: string;
    aiProposalItemId?: string;
  },
) {
  const last = await tx.testCaseVersion.findFirst({
    where: { testCaseId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return tx.testCaseVersion.create({
    data: {
      testCaseId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      title: content.title,
      section: content.section ?? null,
      role: content.role ?? null,
      environment: content.environment ?? null,
      preconditions: content.preconditions ?? null,
      stepsText: content.stepsText ?? null,
      steps: stepsFor(content) as Prisma.InputJsonValue,
      expectedResult: content.expectedResult ?? null,
      testData: content.testData ?? null,
      priority: content.priority,
      executionMode: content.executionMode,
      categories: content.categories ?? [],
      dependsOn: content.dependsOn ?? null,
      changeNote: meta.changeNote ?? null,
      source: meta.source,
      createdBy: meta.createdBy,
      importRowId: meta.importRowId,
      aiProposalItemId: meta.aiProposalItemId,
    },
  });
}

/** Latest version of a case (the "current" definition). */
export async function latestVersion(tx: Tx, testCaseId: string) {
  return tx.testCaseVersion.findFirstOrThrow({ where: { testCaseId }, orderBy: { versionNumber: "desc" } });
}
