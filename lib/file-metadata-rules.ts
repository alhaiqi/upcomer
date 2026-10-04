import type { ExamType } from "@prisma/client";

// File metadata rules shared by the server and the browser forms; no database access here.

export const EXAM_TYPES: { value: ExamType; label: string }[] = [
  { value: "MIDTERM", label: "Midterm" },
  { value: "FINAL", label: "Final" },
  { value: "QUIZ", label: "Quiz" },
  { value: "OTHER", label: "Other" },
];
export const examTypeLabel = (type: ExamType) => EXAM_TYPES.find(item => item.value === type)?.label ?? type;

export const YEAR_MIN = 1950;
export const latestYear = (now = new Date()) => now.getFullYear() + 1;
export const MAX_TOPIC_LENGTH = 100;

// Found from the form alone, from the database references, or because the file itself is gone.
export type FileMetadataFieldError = "course_required" | "invalid_year" | "topic_too_long" | "invalid_type" | "type_not_allowed";
export type FileMetadataReferenceError = "course_not_found" | "professor_not_assigned" | "term_not_found";
export type FileMetadataError = FileMetadataFieldError | FileMetadataReferenceError | "not_found";

export function fileMetadataMessage(error: string, now = new Date()) {
  switch (error) {
    case "course_required": return "Choose a course.";
    case "course_not_found": return "The selected course doesn't exist.";
    case "invalid_year": return `Year must be a 4-digit year between ${YEAR_MIN} and ${latestYear(now)}.`;
    case "topic_too_long": return `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer.`;
    case "professor_not_assigned": return "The selected professor doesn't teach the selected course.";
    case "term_not_found": return "The selected term doesn't exist.";
    case "invalid_type": return "Choose Midterm, Final, Quiz, or Other as the type.";
    case "type_not_allowed": return "Only exams have a type.";
    case "not_found": return "That file doesn't exist anymore.";
    default: return "Something went wrong. Please try again.";
  }
}
