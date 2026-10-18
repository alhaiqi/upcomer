import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { examTypeLabel } from "@/lib/file-metadata-rules";
import { getReviewQueue } from "@/lib/submission-review";
import { publishSubmissionAction, rejectSubmissionAction } from "@/lib/submission-review-actions";
import { reviewMessage } from "@/lib/submission-review-rules";
import { MAX_REJECTION_REASON_LENGTH } from "@/lib/submissions";

export const dynamic = "force-dynamic";

const date = (value: Date) => `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function Notice({ published, rejected, error }: { published?: string; rejected?: string; error?: string }) {
  if (error) return <p className="notice error" role="alert">{reviewMessage(error)}</p>;
  if (published) return <p className="notice" role="status">Published. The file is on its course page now, and an exam&apos;s questions join the question bank.</p>;
  if (rejected) return <p className="notice" role="status">Rejected. The student can see the reason.</p>;
  return null;
}

export default async function SubmissionQueuePage({ searchParams }: { searchParams: Promise<{ published?: string; rejected?: string; error?: string; page?: string }> }) {
  await requireAdmin("/admin/submissions");
  const { page: requestedPage, ...notice } = await searchParams;
  const { items: queue, total, page, totalPages } = await getReviewQueue(Number(requestedPage ?? 1));
  return <><Link className="back" href="/admin/catalog">← Back to catalog</Link><span className="eyebrow">Admin</span><h1>Review Submissions</h1>
    <p className="muted">Files students submitted, oldest first. Publish a file to add it to its course, or reject it with a reason.</p>
    <Notice {...notice} />
    {total > 0 && <p className="muted" role="status">{total} {total === 1 ? "submission is" : "submissions are"} waiting.</p>}
    {queue.length ? <ol className="list catalog-list" aria-label="Pending submissions">{queue.map(file => <li className="card" key={file.id}>
      <span className="eyebrow">{file.course.code} · {file.category === "EXAM" ? "Exam" : "Material"}</span><h3>{file.title}</h3>
      <p className="muted">Submitted by {file.submittedBy?.name ?? "a deleted account"} on {date(file.createdAt)}</p>
      <p className="muted">{[
        file.examType && examTypeLabel(file.examType), file.term?.name, file.year, file.professor?.name, file.topic,
      ].filter(Boolean).join(" · ") || "No details yet."}</p>
      <p className="catalog-links">
        <a href={`/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.title}`}>Open file</a>
        <Link href={`/admin/files/${encodeURIComponent(file.id)}`} aria-label={`Edit details of ${file.title}`}>Edit details</Link>
      </p>
      <form action={publishSubmissionAction}>
        <input type="hidden" name="id" value={file.id} />
        <input type="hidden" name="page" value={page} />
        <button className="button" type="submit" aria-label={`Publish ${file.title}`}>Publish</button>
      </form>
      <form className="form" action={rejectSubmissionAction}>
        <input type="hidden" name="id" value={file.id} />
        <input type="hidden" name="page" value={page} />
        <label className="field">Reason for rejecting {file.title}
          <textarea name="reason" required maxLength={MAX_REJECTION_REASON_LENGTH} rows={3} />
        </label>
        <button className="button" type="submit" aria-label={`Reject ${file.title}`}>Reject</button>
      </form>
    </li>)}</ol> : <p className="card muted">No submissions are waiting for review.</p>}
    {totalPages > 1 && <nav className="pagination" aria-label="Queue pages">
      {page > 1 && <Link className="button" href={`/admin/submissions?page=${page - 1}`}>← Older</Link>}
      <span className="muted">Page {page} of {totalPages}</span>
      {page < totalPages && <Link className="button" href={`/admin/submissions?page=${page + 1}`}>Newer →</Link>}
    </nav>}
  </>;
}
