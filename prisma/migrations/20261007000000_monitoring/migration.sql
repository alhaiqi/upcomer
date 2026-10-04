-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "event" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogEntry_createdAt_idx" ON "LogEntry"("createdAt");

-- CreateIndex
CREATE INDEX "LogEntry_level_createdAt_idx" ON "LogEntry"("level", "createdAt");

-- CreateIndex
CREATE INDEX "LogEntry_event_createdAt_idx" ON "LogEntry"("event", "createdAt");

