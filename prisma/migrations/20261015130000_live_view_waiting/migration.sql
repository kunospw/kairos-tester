-- AlterEnum
ALTER TYPE "RunItemStatus" ADD VALUE 'WAITING';

-- AlterTable
ALTER TABLE "RunnerStatus" ADD COLUMN     "frame" BYTEA,
ADD COLUMN     "frameAt" TIMESTAMP(3),
ADD COLUMN     "frameItemId" TEXT;
