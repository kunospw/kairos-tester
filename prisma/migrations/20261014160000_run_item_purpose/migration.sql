-- CreateEnum
CREATE TYPE "RunItemPurpose" AS ENUM ('TEST', 'SETUP');

-- AlterTable
ALTER TABLE "RunItem" ADD COLUMN     "purpose" "RunItemPurpose" NOT NULL DEFAULT 'TEST';
