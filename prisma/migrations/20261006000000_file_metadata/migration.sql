-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('MIDTERM', 'FINAL', 'QUIZ', 'OTHER');

-- AlterTable
ALTER TABLE "CourseFile" ADD COLUMN     "examType" "ExamType",
ADD COLUMN     "termId" TEXT;

-- CreateIndex
CREATE INDEX "CourseFile_termId_idx" ON "CourseFile"("termId");

-- AddForeignKey
ALTER TABLE "CourseFile" ADD CONSTRAINT "CourseFile_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Move the free-text session into the term and exam type (US-72). No session text is dropped:
-- anything that is not exactly a term name, or exactly a type word on an exam, is kept in the topic.

-- A session that is exactly a term name links to that term, for any category.
UPDATE "CourseFile" AS f SET "termId" = t."id"
FROM "Term" AS t
WHERE f."session" IS NOT NULL AND lower(t."name") = lower(trim(f."session"));

-- Exams get a type by prefix ("Midterm 2" is a midterm). An exam whose session matched nothing is Other.
UPDATE "CourseFile" SET "examType" = CASE
    WHEN lower(trim("session")) LIKE 'midterm%' THEN 'MIDTERM'::"ExamType"
    WHEN lower(trim("session")) LIKE 'final%' THEN 'FINAL'::"ExamType"
    WHEN lower(trim("session")) LIKE 'quiz%' THEN 'QUIZ'::"ExamType"
    WHEN "termId" IS NULL THEN 'OTHER'::"ExamType"
  END
WHERE "category" = 'EXAM' AND trim(coalesce("session", '')) <> '';

-- Keep the original text in the topic unless the term or type says exactly the same thing.
UPDATE "CourseFile" SET "topic" = CASE
    WHEN trim(coalesce("topic", '')) = '' THEN trim("session")
    ELSE "topic" || ' (session: ' || trim("session") || ')'
  END
WHERE trim(coalesce("session", '')) <> ''
  AND "termId" IS NULL
  AND NOT ("category" = 'EXAM' AND lower(trim("session")) IN ('midterm', 'final', 'quiz'));

-- Refuse to drop the column if any session text would be lost.
DO $$
DECLARE lost integer;
BEGIN
  SELECT count(*) INTO lost FROM "CourseFile"
  WHERE trim(coalesce("session", '')) <> ''
    AND "termId" IS NULL
    AND NOT ("category" = 'EXAM' AND "examType" IS NOT NULL AND lower(trim("session")) IN ('midterm', 'final', 'quiz'))
    AND strpos(coalesce("topic", ''), trim("session")) = 0;
  IF lost > 0 THEN
    RAISE EXCEPTION 'US-72 migration: % file(s) would lose their session text', lost;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "CourseFile" DROP COLUMN "session";
