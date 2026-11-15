import { logError } from "@/lib/logger";
import { recommendNext, type StudyNext } from "@/lib/study-next-rules";
import { readTopicInputs, TopicReadFailed, type TopicInputs } from "@/lib/topic-strengths";

// US-30: the topic a student should study next in one course, from that course's learning profile (never another
// course's, never another student's) and its published exam papers. Read fresh on every call, so practice recorded
// through recordLearningEvents (US-25) shows on the next page load. Nothing here checks the caller: the page calls
// requireUser() first and passes the session user's ID. Topics the student marked as covered (US-32) are left out. Topics
// are never logged.

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");

// `inputs` lets the page share one read with its other sections; without it the function reads for itself.
export async function getStudyNext(userId: string, courseId: string, inputs: Promise<TopicInputs> = readTopicInputs(userId, courseId)): Promise<StudyNext> {
  let result: StudyNext;
  try {
    const { profile, courseTopics, totalPapers, covered } = await inputs;
    result = recommendNext(profile, courseTopics, totalPapers, covered);
  } catch (error) {
    // One line per failed page load: the step that failed and the error's type, never its message.
    const failure = error instanceof TopicReadFailed ? error : null;
    logError("study_recommendation_failed", { userId, courseId, step: failure?.source ?? "selection", errorType: errorType(failure ? failure.cause : error) });
    throw failure ? failure.cause : error;
  }
  if (result.invalidTopics) {
    logError("study_recommendation_invalid_inputs", { userId, courseId, affectedTopics: String(result.invalidTopics), reasons: result.reasons.join(",") });
  }
  return result;
}
