-- CreateEnum
CREATE TYPE "AdviceScopeKind" AS ENUM ('COURSE', 'EXAM', 'SESSION', 'TOPIC', 'QUESTION');

-- CreateEnum
CREATE TYPE "AdviceStatus" AS ENUM ('VISIBLE', 'REMOVED');

-- CreateTable
CREATE TABLE "Advice" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "authorId" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "scopeKind" "AdviceScopeKind" NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "fileId" TEXT,
    "termId" TEXT,
    "groupId" TEXT,
    "topicKey" TEXT,
    "topic" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resourceUrl" TEXT,
    "resourceTitle" TEXT,
    "status" "AdviceStatus" NOT NULL DEFAULT 'VISIBLE',
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Advice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Advice_courseId_status_createdAt_idx" ON "Advice"("courseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Advice_courseId_topicKey_idx" ON "Advice"("courseId", "topicKey");

-- CreateIndex
CREATE INDEX "Advice_authorId_idx" ON "Advice"("authorId");

-- CreateIndex
CREATE INDEX "Advice_fileId_idx" ON "Advice"("fileId");

-- CreateIndex
CREATE INDEX "Advice_termId_idx" ON "Advice"("termId");

-- CreateIndex
CREATE INDEX "Advice_groupId_idx" ON "Advice"("groupId");

-- AddForeignKey
ALTER TABLE "Advice" ADD CONSTRAINT "Advice_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advice" ADD CONSTRAINT "Advice_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advice" ADD CONSTRAINT "Advice_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CourseFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advice" ADD CONSTRAINT "Advice_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advice" ADD CONSTRAINT "Advice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuestionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advice" ADD CONSTRAINT "Advice_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
