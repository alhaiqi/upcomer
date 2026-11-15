-- AlterTable
ALTER TABLE "MockExam" ADD COLUMN     "includeGenerated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MockExamQuestion" ADD COLUMN     "generatedQuestionId" TEXT,
ADD COLUMN     "questionId" TEXT;

-- CreateIndex
CREATE INDEX "MockExamQuestion_questionId_idx" ON "MockExamQuestion"("questionId");

-- CreateIndex
CREATE INDEX "MockExamQuestion_generatedQuestionId_idx" ON "MockExamQuestion"("generatedQuestionId");

-- AddForeignKey
ALTER TABLE "MockExamQuestion" ADD CONSTRAINT "MockExamQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockExamQuestion" ADD CONSTRAINT "MockExamQuestion_generatedQuestionId_fkey" FOREIGN KEY ("generatedQuestionId") REFERENCES "GeneratedPracticeQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

