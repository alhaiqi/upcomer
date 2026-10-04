import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogNotice } from "@/components/catalog-notice";
import { requireAdmin } from "@/lib/auth";
import { saveProfessorAction } from "@/lib/catalog-admin-actions";
import { getProfessor } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function EditProfessorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/professors");
  const [{ id }, notice] = await Promise.all([params, searchParams]);
  const professor = await getProfessor(id);
  if (!professor) notFound();
  return <><Link className="back" href="/admin/catalog/professors">← Back to professors</Link><span className="eyebrow">Admin</span><h1>Edit Professor</h1>
    <CatalogNotice entity="professor" {...notice} />
    <form className="card form" action={saveProfessorAction}>
      <input type="hidden" name="id" value={professor.id} />
      <label className="field"><span>Name</span><input name="name" defaultValue={professor.name} required /></label>
      <button className="button" type="submit">Save professor</button>
    </form>
  </>;
}
