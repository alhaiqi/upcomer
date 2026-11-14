ALTER TABLE "LearningTopic" ADD COLUMN "baselineWeakness" DOUBLE PRECISION,
ADD COLUMN "correctCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "incorrectCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LearningTopic" ADD CONSTRAINT "LearningTopic_evidence_bounds"
CHECK ("correctCount" >= 0 AND "incorrectCount" >= 0 AND ("baselineWeakness" IS NULL OR ("baselineWeakness" >= 0 AND "baselineWeakness" <= 1)));

CREATE TYPE "LearningSource" AS ENUM ('QUESTION_BANK', 'MOCK_EXAM', 'FLASHCARD', 'AI_INTERACTION');
CREATE TYPE "PracticeDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

CREATE TABLE "GeneratedPracticeQuestion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "sourceQuestionId" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "topicKey" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "difficulty" "PracticeDifficulty" NOT NULL,
  "prompt" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "generatorVersion" TEXT NOT NULL,
  "rubric" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedPracticeQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneratedPracticeQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeneratedPracticeQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeneratedPracticeQuestion_sourceQuestionId_fkey" FOREIGN KEY ("sourceQuestionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GeneratedPracticeQuestion_userId_courseId_contentHash_key" ON "GeneratedPracticeQuestion"("userId", "courseId", "contentHash");
CREATE INDEX "GeneratedPracticeQuestion_userId_courseId_difficulty_idx" ON "GeneratedPracticeQuestion"("userId", "courseId", "difficulty");
CREATE INDEX "GeneratedPracticeQuestion_sourceQuestionId_idx" ON "GeneratedPracticeQuestion"("sourceQuestionId");

CREATE TABLE "LearningEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "source" "LearningSource" NOT NULL,
  "eventId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "topicKey" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "correct" BOOLEAN NOT NULL,
  "questionId" TEXT,
  "generatedQuestionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningEvent_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningEvent_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LearningEvent_generatedQuestionId_fkey" FOREIGN KEY ("generatedQuestionId") REFERENCES "GeneratedPracticeQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearningEvent_userId_source_eventId_key" ON "LearningEvent"("userId", "source", "eventId");
CREATE INDEX "LearningEvent_userId_courseId_topicKey_idx" ON "LearningEvent"("userId", "courseId", "topicKey");
CREATE INDEX "LearningEvent_questionId_idx" ON "LearningEvent"("questionId");
CREATE INDEX "LearningEvent_generatedQuestionId_idx" ON "LearningEvent"("generatedQuestionId");
