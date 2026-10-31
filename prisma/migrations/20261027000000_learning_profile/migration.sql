-- CreateTable
CREATE TABLE "LearningTopic" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "weakness" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningTopic_pkey" PRIMARY KEY ("userId","courseId","topicKey")
);

-- CreateIndex
CREATE INDEX "LearningTopic_courseId_idx" ON "LearningTopic"("courseId");

-- AddForeignKey
ALTER TABLE "LearningTopic" ADD CONSTRAINT "LearningTopic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningTopic" ADD CONSTRAINT "LearningTopic_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

