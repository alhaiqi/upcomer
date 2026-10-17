"use client";

import { useState, type FormEvent } from "react";
import { FileMetadataFields } from "@/components/file-metadata-fields";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/upload-rules";
import type { UploadCourseOption } from "@/lib/uploads";

type Category = "EXAM" | "MATERIAL";

// A plain multipart form posted to /api/submissions, so it works without JavaScript. With it, the Type field follows the
// category and an oversized file is caught before it is sent. The server checks every rule again.
export function SubmissionForm({ courses, terms, initialCourseId = "", initialCategory = "EXAM" }: {
  courses: UploadCourseOption[]; terms: { id: string; name: string }[]; initialCourseId?: string; initialCategory?: Category;
}) {
  const [category, setCategory] = useState<Category>(initialCategory);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  if (!courses.length) return <p className="card muted">No courses exist yet, so there is nothing to submit to.</p>;

  function submit(event: FormEvent<HTMLFormElement>) {
    const file = new FormData(event.currentTarget).get("file");
    if (file instanceof File && file.size > MAX_UPLOAD_BYTES) {
      event.preventDefault();
      setError(`The file is larger than ${MAX_UPLOAD_LABEL}.`);
      return;
    }
    setError("");
    setSending(true);
  }

  return <form className="card form" action="/api/submissions" method="post" encType="multipart/form-data" onSubmit={submit}>
    <fieldset className="checkbox-list">
      <legend>What are you submitting?</legend>
      <label><input type="radio" name="category" value="EXAM" defaultChecked={category === "EXAM"} onChange={() => setCategory("EXAM")} /> A past exam</label>
      <label><input type="radio" name="category" value="MATERIAL" defaultChecked={category === "MATERIAL"} onChange={() => setCategory("MATERIAL")} /> Course material</label>
    </fieldset>
    {/* The same course, professor, year, term, type, and topic fields and rules as the admin upload (US-72). */}
    <FileMetadataFields category={category} courses={courses} terms={terms} file={{ courseId: initialCourseId }} />
    <label>Title
      <input name="title" required maxLength={150} placeholder={category === "EXAM" ? "Final Exam 2025" : "Network Models Lecture"} />
    </label>
    <label>File
      <input name="file" type="file" required accept=".pdf,application/pdf" />
      <span className="muted">PDF only, up to {MAX_UPLOAD_LABEL}.</span>
    </label>
    <button className="button" type="submit" disabled={sending}>{sending ? "Submitting…" : "Submit for review"}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
