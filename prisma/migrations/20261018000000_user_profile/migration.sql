-- AlterTable
ALTER TABLE "User" ADD COLUMN     "facultyId" TEXT,
ADD COLUMN     "major" TEXT;

-- CreateIndex
CREATE INDEX "User_facultyId_idx" ON "User"("facultyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
