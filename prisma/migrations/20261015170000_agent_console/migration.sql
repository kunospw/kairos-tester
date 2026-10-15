-- CreateEnum
CREATE TYPE "PauseState" AS ENUM ('NONE', 'REQUESTED', 'PAUSED');

-- CreateEnum
CREATE TYPE "AgentStepKind" AS ENUM ('AI', 'RECIPE', 'PERSON', 'SYSTEM');

-- AlterTable
ALTER TABLE "RunItem" ADD COLUMN     "pause" "PauseState" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runItemId" TEXT NOT NULL,
    "kind" "AgentStepKind" NOT NULL,
    "label" TEXT NOT NULL,
    "thought" TEXT,
    "result" TEXT,
    "ok" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCommand" (
    "id" TEXT NOT NULL,
    "runItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "by" TEXT NOT NULL,
    "stepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "AgentCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentStep_runItemId_createdAt_idx" ON "AgentStep"("runItemId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCommand_runItemId_handledAt_idx" ON "AgentCommand"("runItemId", "handledAt");

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runItemId_fkey" FOREIGN KEY ("runItemId") REFERENCES "RunItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_runItemId_fkey" FOREIGN KEY ("runItemId") REFERENCES "RunItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
