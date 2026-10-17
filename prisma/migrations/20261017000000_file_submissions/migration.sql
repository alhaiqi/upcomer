-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- AlterTable
ALTER TABLE "CourseFile" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "FileStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "submittedById" TEXT;

-- CreateIndex
CREATE INDEX "CourseFile_status_createdAt_idx" ON "CourseFile"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CourseFile_submittedById_idx" ON "CourseFile"("submittedById");

-- AddForeignKey
ALTER TABLE "CourseFile" ADD CONSTRAINT "CourseFile_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
