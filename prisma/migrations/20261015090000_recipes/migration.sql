-- AlterEnum
ALTER TYPE "AiProposalKind" ADD VALUE 'RECIPE';

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RecipeScope" AS ENUM ('SETUP', 'TEST', 'ALL');

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "environmentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "matchRule" JSONB NOT NULL,
    "scope" "RecipeScope" NOT NULL DEFAULT 'ALL',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL,
    "successChecks" JSONB NOT NULL,
    "status" "RecipeStatus" NOT NULL DEFAULT 'ACTIVE',
    "aiProposalItemId" TEXT NOT NULL,
    "supersedesId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledBy" TEXT,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_aiProposalItemId_key" ON "Recipe"("aiProposalItemId");

-- CreateIndex
CREATE INDEX "Recipe_applicationId_status_idx" ON "Recipe"("applicationId", "status");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_aiProposalItemId_fkey" FOREIGN KEY ("aiProposalItemId") REFERENCES "AiProposalItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
