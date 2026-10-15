-- CreateEnum
CREATE TYPE "TakeoverState" AS ENUM ('NONE', 'REQUESTED', 'ACTIVE');

-- AlterTable
ALTER TABLE "RunItem" ADD COLUMN "takeover" "TakeoverState" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "LiveInput" (
    "id" TEXT NOT NULL,
    "runItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveInput_runItemId_createdAt_idx" ON "LiveInput"("runItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "LiveInput" ADD CONSTRAINT "LiveInput_runItemId_fkey" FOREIGN KEY ("runItemId") REFERENCES "RunItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
