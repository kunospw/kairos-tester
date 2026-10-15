-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunItemStatus" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_HUMAN', 'DONE', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "RunPlan" AS ENUM ('AUTOMATABLE', 'NEEDS_HUMAN', 'NOT_ALLOWED');

-- CreateEnum
CREATE TYPE "HumanRequestKind" AS ENUM ('MANUAL_CASE', 'INPUT', 'CONFIRM_RESULT', 'RUN_ERROR');

-- CreateEnum
CREATE TYPE "HumanRequestStatus" AS ENUM ('OPEN', 'ANSWERED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Environment" ADD COLUMN     "agentProfile" JSONB,
ADD COLUMN     "disposable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ExecutionAttempt" ADD COLUMN     "aiConfidence" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT NOT NULL,
    "startedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "cycleCaseId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "plan" "RunPlan" NOT NULL,
    "planReason" TEXT,
    "status" "RunItemStatus" NOT NULL DEFAULT 'QUEUED',
    "statusNote" TEXT,
    "currentStep" TEXT,
    "attemptId" TEXT,
    "lastShotId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanRequest" (
    "id" TEXT NOT NULL,
    "runItemId" TEXT NOT NULL,
    "kind" "HumanRequestKind" NOT NULL,
    "question" TEXT NOT NULL,
    "detail" TEXT,
    "status" "HumanRequestStatus" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runItemId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunnerStatus" (
    "id" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "info" TEXT,

    CONSTRAINT "RunnerStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunItem_runId_status_idx" ON "RunItem"("runId", "status");

-- CreateIndex
CREATE INDEX "HumanRequest_status_idx" ON "HumanRequest"("status");

-- CreateIndex
CREATE INDEX "RunEvent_runId_createdAt_idx" ON "RunEvent"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "TestCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunItem" ADD CONSTRAINT "RunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunItem" ADD CONSTRAINT "RunItem_cycleCaseId_fkey" FOREIGN KEY ("cycleCaseId") REFERENCES "CycleCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunItem" ADD CONSTRAINT "RunItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanRequest" ADD CONSTRAINT "HumanRequest_runItemId_fkey" FOREIGN KEY ("runItemId") REFERENCES "RunItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
