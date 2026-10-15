-- AlterEnum
ALTER TYPE "AttemptSource" ADD VALUE 'AI_AGENT';

-- AlterEnum
ALTER TYPE "ExecutionMethod" ADD VALUE 'AI_DRIVEN';

-- AlterTable
ALTER TABLE "ExecutionAttempt" ADD COLUMN     "agentLabel" TEXT,
ADD COLUMN     "proposedOutcome" "Outcome";
