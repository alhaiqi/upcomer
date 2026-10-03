"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, UPLOAD_ACCEPT, UPLOAD_TYPES_LABEL } from "@/lib/upload-rules";
import type { UploadCourseOption } from "@/lib/uploads";

type Uploaded = { id: string; title: string; courseId: string; url: string };
type Status = { state: "idle" | "sending" } | { state: "error"; message: string } | { state: "done"; file: Uploaded };

export function UploadForm({ category, courses, initialCourseId = "" }: { category: "EXAM" | "MATERIAL"; courses: UploadCourseOption[]; initialCourseId?: string }) {
  const [courseId, setCourseId] = useState(courses.some(course => course.id === initialCourseId) ? initialCourseId : "");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const isExam = category === "EXAM";
  const noun = isExam ? "exam" : "material";
  const professors = courses.find(course => course.id === courseId)?.professors ?? [];

  if (!courses.length) return <p className="card muted">No courses exist yet. Add a course to the catalog before uploading.</p>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (file instanceof File && file.size > MAX_UPLOAD_BYTES) {
      setStatus({ state: "error", message: `The file is larger than ${MAX_UPLOAD_LABEL}.` });
      return;
    }
    setStatus({ state: "sending" });
    try {
      const response = await fetch("/api/admin/uploads", { method: "POST", body: data });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.file) {
        setStatus({ state: "error", message: body?.error ?? "The upload failed. Please try again." });
        return;
      }
      form.reset();
      setStatus({ state: "done", file: body.file });
    } catch {
      setStatus({ state: "error", message: "The upload failed. Check your connection and try again." });
    }
  }

  return <form className="card form" onSubmit={submit}>
    <input type="hidden" name="category" value={category} />
    <label>Course
      <select name="courseId" required value={courseId} onChange={event => setCourseId(event.target.value)}>
        <option value="">Choose a course</option>
        {courses.map(course => <option key={course.id} value={course.id}>{course.code} — {course.name}</option>)}
      </select>
    </label>
    <label>Title
      <input name="title" required maxLength={150} placeholder={isExam ? "Final Exam 2025" : "Network Models Lecture"} />
    </label>
    <label>Professor (optional)
      <select name="professorId" defaultValue="" key={courseId}>
        <option value="">Not specified</option>
        {professors.map(professor => <option key={professor.id} value={professor.id}>{professor.name}</option>)}
      </select>
    </label>
    <label>Year (optional)
      <input name="year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="2025" />
    </label>
    {isExam && <label>Session (optional)
      <input name="session" maxLength={50} placeholder="Midterm, Final, Quiz 1" />
    </label>}
    <label>Topic (optional)
      <input name="topic" maxLength={100} />
    </label>
    <label>File
      <input name="file" type="file" required accept={UPLOAD_ACCEPT} />
      <span className="muted">{UPLOAD_TYPES_LABEL}, up to {MAX_UPLOAD_LABEL}.</span>
    </label>
    <button className="button" type="submit" disabled={status.state === "sending"}>{status.state === "sending" ? "Uploading…" : `Upload ${noun}`}</button>
    {status.state === "error" && <p className="form-error" role="alert">{status.message}</p>}
    {status.state === "done" && <p className="form-success" role="status">
      Uploaded “{status.file.title}”. <a href={status.file.url} target="_blank" rel="noopener noreferrer">Open Original File</a> · <Link href={`/courses/${status.file.courseId}/${isExam ? "exams" : "materials"}`}>View course {noun}s</Link>
    </p>}
  </form>;
}
