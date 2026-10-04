"use client";

import { useState } from "react";
import { EXAM_TYPES, MAX_TOPIC_LENGTH } from "@/lib/file-metadata-rules";
import type { UploadCourseOption } from "@/lib/uploads";

type Option = { id: string; name: string };
export type FileMetadataValues = { courseId?: string; professorId?: string | null; termId?: string | null; year?: number | null; topic?: string | null; examType?: string | null };

// The metadata fields shared by the upload form and the admin edit form. The server checks every rule again.
export function FileMetadataFields({ category, courses, terms, file = {} }: {
  category: "EXAM" | "MATERIAL"; courses: UploadCourseOption[]; terms: Option[]; file?: FileMetadataValues;
}) {
  const [courseId, setCourseId] = useState(courses.some(course => course.id === file.courseId) ? file.courseId! : "");
  // Only the chosen course's professors are offered, and changing the course clears the professor.
  const professors = courses.find(course => course.id === courseId)?.professors ?? [];
  const professorId = courseId === file.courseId ? file.professorId ?? "" : "";

  return <>
    <label>Course
      <select name="courseId" required value={courseId} onChange={event => setCourseId(event.target.value)}>
        <option value="">Choose a course</option>
        {courses.map(course => <option key={course.id} value={course.id}>{course.code} — {course.name}</option>)}
      </select>
    </label>
    <label>Professor (optional)
      <select name="professorId" defaultValue={professorId} key={courseId}>
        <option value="">Not specified</option>
        {professors.map(professor => <option key={professor.id} value={professor.id}>{professor.name}</option>)}
      </select>
    </label>
    <label>Year (optional)
      <input name="year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="2025" defaultValue={file.year ?? ""} />
    </label>
    <label>Term (optional)
      <select name="termId" defaultValue={file.termId ?? ""}>
        <option value="">Not specified</option>
        {terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}
      </select>
    </label>
    {category === "EXAM" && <label>Type (optional)
      <select name="examType" defaultValue={file.examType ?? ""}>
        <option value="">Not specified</option>
        {EXAM_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
    </label>}
    <label>Topic (optional)
      <input name="topic" maxLength={MAX_TOPIC_LENGTH} defaultValue={file.topic ?? ""} />
    </label>
  </>;
}
