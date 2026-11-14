import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getAdminFile } from "@/lib/file-metadata";
import { fileManagementMessage } from "@/lib/file-management";
import { MAX_UPLOAD_LABEL } from "@/lib/upload-rules";
import styles from "@/components/practice.module.css";

export const dynamic = "force-dynamic";
export default async function ManageFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; cleanup?: string }> }) {
  await requireAdmin("/admin/files");
  const [{ id }, notice] = await Promise.all([params, searchParams]);
  const file = await getAdminFile(id);
  if (!file) notFound();
  const action = `/api/admin/files/${encodeURIComponent(id)}`;
  return <><Link className="back" href={`/admin/files/${encodeURIComponent(id)}`}>Back to file details</Link><h1>Replace or remove file</h1><p>{file.title}</p>
    {notice.saved === "1" && <p className="notice" role="status">File replaced. Source questions and rankings are updated.</p>}
    {notice.cleanup && <p className="notice" role="alert">The file record was updated, but old storage cleanup needs an administrator&apos;s attention. Check monitoring.</p>}
    {notice.error && <p className="notice error" role="alert">{fileManagementMessage(notice.error)}</p>}
    <form action={action} method="post" encType="multipart/form-data" className="card form">
      <h2>Replace file</h2><p className="muted">Keeps this file&apos;s link and metadata. Existing extracted questions are replaced and rankings recalculated. Old practice items derived from this source are removed. Exams require a searchable PDF with numbered questions. Maximum {MAX_UPLOAD_LABEL}.</p>
      <input type="hidden" name="operation" value="replace" /><input type="hidden" name="version" value={file.updatedAt.toISOString()} />
      <label className="field">Replacement file<input type="file" name="file" required accept={file.category === "EXAM" ? ".pdf" : ".pdf,.docx,.pptx,.png,.jpg,.jpeg"} /></label><button className="button" type="submit">Replace file</button>
    </form>
    <form action={action} method="post" className={`card form ${styles.confirmation}`}><h2>Remove file</h2><p className="muted">Removes the file and its extracted questions. Historical practice evidence is kept, while source links and rankings are updated.</p>
      <input type="hidden" name="operation" value="remove" /><input type="hidden" name="version" value={file.updatedAt.toISOString()} />
      <label><input type="checkbox" name="confirm" value="yes" required /> I confirm that this file should be removed.</label><button className="button" type="submit">Remove file</button>
    </form>
  </>;
}
