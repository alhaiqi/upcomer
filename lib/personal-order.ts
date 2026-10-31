import { db } from "@/lib/db";
import { PUBLISHED_FILES } from "@/lib/file-visibility";
import type { ExamQuestion } from "@/lib/consolidated-exam";
import { getLearningProfile, questionTopic, type LearningProfile } from "@/lib/learning-profile";
import { logError } from "@/lib/logger";

// The personal order of the Upcomer Exam (US-28): the same questions, reordered by the student's priorities, so their
// weak, high-frequency questions come first. Each question keeps its number (its place in the frequency order), so marks,
// reports, and links to a question mean the same question in both orders. A student without a learning profile in the
// course (US-33) gets the frequency order unchanged.

// PLACEHOLDER for US-24 (Mustafa Ergaibi): the weakness used for a topic the student has no score for, standing in for
// US-24's neutral default for a student who skips rating. Replace or remove it with US-24.
export const NEUTRAL_WEAKNESS = 0.5;

// PLACEHOLDER for US-27 (Mustafa Ergaibi): replace this function only. A question's priority for one student, from how
// often it appeared (paperCount of the course's totalPapers) and the student's weakness in its topic (0 strong to 1 weak).
// Higher comes first. Of two equally weak questions the more frequent ranks higher; of two equally frequent ones the
// weaker; the same inputs always give the same priority. The personal order calls nothing else to rank questions.
export function personalPriority(paperCount: number, totalPapers: number, weakness: number): number {
  const share = totalPapers > 0 ? paperCount / totalPapers : 0;
  return share * (0.5 + weakness);
}

export type PersonalOrder = { questions: ExamQuestion[]; hasProfile: boolean };

// Two priorities this close are equal; the frequency order decides between them.
export const PRIORITY_TIE = 1e-9;

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");

// Reorders the exam's questions by personalPriority. paperTopics gives each paper's topic (CourseFile.topic); a question's
// topic is its papers' most common one (questionTopic, US-33). Ties keep the frequency order. Without a profile, the
// questions come back in the frequency order. The questions themselves are not changed.
export function personalizeQuestions(questions: ExamQuestion[], paperTopics: ReadonlyMap<string, string | null>, profile: LearningProfile): PersonalOrder {
  if (!profile.size) return { questions, hasProfile: false };
  const ranked = questions.map(question => {
    const topic = questionTopic(question.papers.map(paper => ({ topic: paperTopics.get(paper.id) ?? null })));
    const weakness = (topic && profile.get(topic.topicKey)?.weakness) ?? NEUTRAL_WEAKNESS;
    return { question, priority: personalPriority(question.paperCount, question.totalPapers, weakness) };
  });
  // Priorities closer than PRIORITY_TIE are a tie, so rounding (3/5 × 0.5 against 1/5 × 1.5) never decides the order.
  ranked.sort((a, b) => (Math.abs(b.priority - a.priority) > PRIORITY_TIE ? b.priority - a.priority : a.question.position - b.question.position));
  return { questions: ranked.map(item => item.question), hasProfile: true };
}

// The personal order of a course's exam for one student: their profile in this course only, and the topics of the
// exam's papers. Only the course's published papers are read (US-13).
export async function getPersonalOrder(userId: string, courseId: string, questions: ExamQuestion[]): Promise<PersonalOrder> {
  const paperIds = [...new Set(questions.flatMap(question => question.papers.map(paper => paper.id)))];
  const [profile, papers] = await Promise.all([
    getLearningProfile(userId, courseId),
    db.courseFile.findMany({ where: { id: { in: paperIds }, courseId, ...PUBLISHED_FILES }, select: { id: true, topic: true } }).catch(error => {
      logError("learning_profile_retrieval_failed", { userId, courseId, source: "personal_order", errorType: errorType(error) });
      throw error;
    }),
  ]);
  return personalizeQuestions(questions, new Map(papers.map(paper => [paper.id, paper.topic])), profile);
}
