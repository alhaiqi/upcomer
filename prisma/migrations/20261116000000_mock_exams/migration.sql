-- CreateEnum
CREATE TYPE "MockExamDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'MIXED');

-- CreateEnum
CREATE TYPE "MockExamStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateTable
CREATE TABLE "MockExam" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicKeys" TEXT[],
    "topics" TEXT[],
    "length" INTEGER NOT NULL,
    "difficulty" "MockExamDifficulty" NOT NULL,
    "status" "MockExamStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockExamQuestion" (
    "id" TEXT NOT NULL,
    "mockExamId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "groupId" TEXT,
    "topicKey" TEXT,
    "topic" TEXT,
    "text" TEXT NOT NULL,
    "paperCount" INTEGER NOT NULL,
    "totalPapers" INTEGER NOT NULL,
    "sourcePapers" TEXT[],
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "MockExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MockExam_userId_courseId_createdAt_idx" ON "MockExam"("userId", "courseId", "createdAt");

-- CreateIndex
CREATE INDEX "MockExam_courseId_idx" ON "MockExam"("courseId");

-- CreateIndex
CREATE INDEX "MockExamQuestion_groupId_idx" ON "MockExamQuestion"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "MockExamQuestion_mockExamId_position_key" ON "MockExamQuestion"("mockExamId", "position");

-- AddForeignKey
ALTER TABLE "MockExam" ADD CONSTRAINT "MockExam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockExam" ADD CONSTRAINT "MockExam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockExamQuestion" ADD CONSTRAINT "MockExamQuestion_mockExamId_fkey" FOREIGN KEY ("mockExamId") REFERENCES "MockExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockExamQuestion" ADD CONSTRAINT "MockExamQuestion_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuestionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
