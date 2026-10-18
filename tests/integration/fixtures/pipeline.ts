import { db } from "@/lib/db";
import { rebuildQuestionBank } from "@/lib/question-bank";

// The exam pipeline as the app has it today: upload (Member 5) -> extraction (US-14) -> grouping and ranking
// (rebuildQuestionBank, US-15a/US-16) -> the consolidated ordered exam (getConsolidatedExam, US-18/US-19).
//
// SWAP POINT: extraction (US-14) is not on main yet, so extractQuestions stores the questions the sample paper is known
// to contain, exactly as an extractor would (one Question per question, numbered from 1, sub-parts on their own lines).
// When US-14 lands, replace its body with the real extractor, for example `await extractExamQuestions(fileId)`, and keep
// `expected` only to check the extractor found the same questions. Nothing else in the tests changes.
export async function extractQuestions(fileId: string, expected: readonly string[]) {
  await db.question.createMany({ data: expected.map((text, index) => ({ fileId, number: index + 1, text })) });
}

// Every stage after the upload, for one paper.
export async function processExam(fileId: string, expected: readonly string[]) {
  await extractQuestions(fileId, expected);
  const file = await db.courseFile.findUniqueOrThrow({ where: { id: fileId }, select: { courseId: true } });
  return rebuildQuestionBank(file.courseId);
}
