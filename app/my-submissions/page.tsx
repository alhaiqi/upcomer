import type { FileStatus } from "@prisma/client";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMySubmissions } from "@/lib/submissions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<FileStatus, string> = { PENDING: "Pending review", PUBLISHED: "Published", REJECTED: "Rejected" };
const submittedOn = (date: Date) => date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export default async function MySubmissionsPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const user = await requireUser("/my-submissions");
  const { submitted } = await searchParams;
  const submissions = await getMySubmissions(user.id);
  return <><h1>My Submissions</h1>
    <p className="muted">Exams and materials you submitted, newest first. Other students see one once an admin publishes it.</p>
    {submitted && <p className="notice" role="status">Submitted for review. Only you and the admins can see it until it is published.</p>}
    <p><Link className="button" href="/submit">Submit an exam or material</Link></p>
    {submissions.length ? <div className="list">{submissions.map(file => <article className="card" key={file.id}>
      <h3>{file.title}</h3>
      <p className="muted">Status: <span className={`status-tag status-${file.status.toLowerCase()}`}>{STATUS_LABELS[file.status]}</span></p>
      <p className="muted"><Link href={`/courses/${encodeURIComponent(file.course.id)}`}>{file.course.code} — {file.course.name}</Link> · {file.category === "EXAM" ? "Exam" : "Material"} · Submitted {submittedOn(file.createdAt)}</p>
      {file.status === "REJECTED" && file.rejectionReason && <p className="notice error">Reason: {file.rejectionReason}</p>}
      <a className="button" href={`/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer">Open Original File</a>
    </article>)}</div> : <p className="card muted">You haven&apos;t submitted anything yet.</p>}
  </>;
}
