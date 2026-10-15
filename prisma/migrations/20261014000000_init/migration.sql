-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EnvironmentType" AS ENUM ('DEVELOPMENT', 'TEST', 'DEMO', 'UAT', 'STAGING', 'PRODUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('WORKBOOK', 'DOCUMENT', 'URL', 'REPOSITORY', 'CONVERSATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ContextCategory" AS ENUM ('ROLES_PERMISSIONS', 'BUSINESS_WORKFLOWS', 'BUSINESS_RULES', 'TECHNICAL_DETAILS', 'REQUIREMENTS_REFERENCES', 'CONSTRAINTS_GAPS');

-- CreateEnum
CREATE TYPE "ContextStatus" AS ENUM ('UNREVIEWED', 'REVIEWED', 'OUTDATED');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('UNKNOWN', 'MANUAL', 'AUTOMATED', 'HYBRID');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNSET');

-- CreateEnum
CREATE TYPE "CaseOrigin" AS ENUM ('IMPORT', 'MANUAL', 'AI_PROPOSAL');

-- CreateEnum
CREATE TYPE "VersionSource" AS ENUM ('IMPORT', 'IMPORT_UPDATE', 'MANUAL', 'AI_PROPOSAL');

-- CreateEnum
CREATE TYPE "CycleKind" AS ENUM ('STANDARD', 'HISTORICAL_IMPORT', 'SIMULATION');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('DRAFT', 'RUNNING', 'AWAITING_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ExecutionMethod" AS ENUM ('UNKNOWN', 'MANUAL', 'AUTOMATED', 'HYBRID', 'SIMULATED');

-- CreateEnum
CREATE TYPE "AttemptSource" AS ENUM ('IMPORT', 'MANUAL', 'RUNNER', 'SIMULATION');

-- CreateEnum
CREATE TYPE "StepResult" AS ENUM ('PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE', 'NOT_RUN');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('APPLICATION_FAILURE', 'BLOCKED_OR_SETUP', 'INCOMPLETE_TESTING', 'AMBIGUOUS_OR_OUTDATED');

-- CreateEnum
CREATE TYPE "FindingSource" AS ENUM ('IMPORT_RULE', 'AI_REVIEW', 'MANUAL');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('SECTION', 'CREATED', 'UPDATED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "AiProposalKind" AS ENUM ('DRAFT_CASES', 'REVIEW_RESULTS', 'REPORT_SUMMARY');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EnvironmentType" NOT NULL DEFAULT 'OTHER',
    "targetUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextEntry" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "category" "ContextCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ContextStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "sourceReferenceId" TEXT,
    "sourceExcerpt" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "origin" "CaseOrigin" NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseVersion" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT,
    "role" TEXT,
    "environment" TEXT,
    "preconditions" TEXT,
    "stepsText" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "expectedResult" TEXT,
    "testData" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'UNSET',
    "executionMode" "ExecutionMode" NOT NULL DEFAULT 'UNKNOWN',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dependsOn" TEXT,
    "changeNote" TEXT,
    "source" "VersionSource" NOT NULL,
    "importRowId" TEXT,
    "aiProposalItemId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationBinding" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "runnerType" TEXT NOT NULL,
    "externalTestId" TEXT,
    "scriptRef" TEXT,
    "notes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCycle" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CycleKind" NOT NULL DEFAULT 'STANDARD',
    "status" "CycleStatus" NOT NULL DEFAULT 'OPEN',
    "scope" TEXT,
    "excludedScope" TEXT,
    "environmentId" TEXT,
    "buildLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "TestCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCase" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "caseVersionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "importNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" TEXT NOT NULL,
    "cycleCaseId" TEXT NOT NULL,
    "caseVersionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'DRAFT',
    "outcome" "Outcome",
    "outcomeReason" TEXT,
    "actualResult" TEXT,
    "remarks" TEXT,
    "partialCoverage" BOOLEAN NOT NULL DEFAULT false,
    "partialCoverageNote" TEXT,
    "tester" TEXT,
    "executionMethod" "ExecutionMethod" NOT NULL DEFAULT 'UNKNOWN',
    "buildLabel" TEXT,
    "source" "AttemptSource" NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "executedOn" DATE,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "humanCheckpointBy" TEXT,
    "humanCheckpointAt" TIMESTAMP(3),
    "importRowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepOutcome" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepText" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "result" "StepResult" NOT NULL DEFAULT 'NOT_RUN',
    "note" TEXT,

    CONSTRAINT "StepOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "caption" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "testCaseId" TEXT,
    "cycleCaseId" TEXT,
    "attemptId" TEXT,
    "type" "FindingType" NOT NULL,
    "source" "FindingSource" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "evidenceExcerpt" TEXT,
    "aiProposalItemId" TEXT,
    "resolutionNote" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "sourceReferenceId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "sheetName" TEXT,
    "mapping" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "section" TEXT,
    "raw" JSONB NOT NULL,
    "action" "ImportRowAction" NOT NULL,
    "message" TEXT,
    "testCaseId" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "AiProposalKind" NOT NULL,
    "model" TEXT NOT NULL,
    "submittedContext" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "cycleId" TEXT,
    "reportId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProposalItem" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "originalPayload" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "AiProposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "includedScope" TEXT,
    "excludedScope" TEXT,
    "data" JSONB NOT NULL,
    "aiSummary" TEXT,
    "aiSummaryReviewed" BOOLEAN NOT NULL DEFAULT false,
    "aiSummaryReviewedBy" TEXT,
    "aiProposalId" TEXT,
    "customerAcceptance" TEXT NOT NULL DEFAULT 'NOT_RECORDED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_name_key" ON "Application"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_applicationId_name_key" ON "Environment"("applicationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_applicationId_externalId_key" ON "TestCase"("applicationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseVersion_importRowId_key" ON "TestCaseVersion"("importRowId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseVersion_aiProposalItemId_key" ON "TestCaseVersion"("aiProposalItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseVersion_testCaseId_versionNumber_key" ON "TestCaseVersion"("testCaseId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationBinding_testCaseId_key" ON "AutomationBinding"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCycle_applicationId_name_key" ON "TestCycle"("applicationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CycleCase_cycleId_testCaseId_key" ON "CycleCase"("cycleId", "testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_importRowId_key" ON "ExecutionAttempt"("importRowId");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_cycleCaseId_status_idx" ON "ExecutionAttempt"("cycleCaseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_cycleCaseId_attemptNumber_key" ON "ExecutionAttempt"("cycleCaseId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StepOutcome_attemptId_stepIndex_key" ON "StepOutcome"("attemptId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_storageKey_key" ON "Evidence"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_aiProposalItemId_key" ON "Finding"("aiProposalItemId");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_idx" ON "ImportRow"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "AiProposalItem_proposalId_index_key" ON "AiProposalItem"("proposalId", "index");

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceReference" ADD CONSTRAINT "SourceReference_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_sourceReferenceId_fkey" FOREIGN KEY ("sourceReferenceId") REFERENCES "SourceReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseVersion" ADD CONSTRAINT "TestCaseVersion_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseVersion" ADD CONSTRAINT "TestCaseVersion_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "ImportRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseVersion" ADD CONSTRAINT "TestCaseVersion_aiProposalItemId_fkey" FOREIGN KEY ("aiProposalItemId") REFERENCES "AiProposalItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationBinding" ADD CONSTRAINT "AutomationBinding_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCycle" ADD CONSTRAINT "TestCycle_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCycle" ADD CONSTRAINT "TestCycle_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCase" ADD CONSTRAINT "CycleCase_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "TestCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCase" ADD CONSTRAINT "CycleCase_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCase" ADD CONSTRAINT "CycleCase_caseVersionId_fkey" FOREIGN KEY ("caseVersionId") REFERENCES "TestCaseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_cycleCaseId_fkey" FOREIGN KEY ("cycleCaseId") REFERENCES "CycleCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_caseVersionId_fkey" FOREIGN KEY ("caseVersionId") REFERENCES "TestCaseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "ImportRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepOutcome" ADD CONSTRAINT "StepOutcome_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_cycleCaseId_fkey" FOREIGN KEY ("cycleCaseId") REFERENCES "CycleCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_aiProposalItemId_fkey" FOREIGN KEY ("aiProposalItemId") REFERENCES "AiProposalItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "TestCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_sourceReferenceId_fkey" FOREIGN KEY ("sourceReferenceId") REFERENCES "SourceReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposalItem" ADD CONSTRAINT "AiProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AiProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "TestCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
