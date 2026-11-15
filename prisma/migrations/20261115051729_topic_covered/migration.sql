-- CreateTable
CREATE TABLE "CoveredTopic" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoveredTopic_pkey" PRIMARY KEY ("userId","courseId","topicKey")
);

-- CreateIndex
CREATE INDEX "CoveredTopic_courseId_idx" ON "CoveredTopic"("courseId");

-- AddForeignKey
ALTER TABLE "CoveredTopic" ADD CONSTRAINT "CoveredTopic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoveredTopic" ADD CONSTRAINT "CoveredTopic_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
