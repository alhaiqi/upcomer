import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogNotice } from "@/components/catalog-notice";
import { requireAdmin } from "@/lib/auth";
import { saveFacultyAction } from "@/lib/catalog-admin-actions";
import { getFaculty } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function EditFacultyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/faculties");
  const [{ id }, notice] = await Promise.all([params, searchParams]);
  const faculty = await getFaculty(id);
  if (!faculty) notFound();
  return <><Link className="back" href="/admin/catalog/faculties">← Back to faculties</Link><span className="eyebrow">Admin</span><h1>Edit Faculty</h1>
    <CatalogNotice entity="faculty" {...notice} />
    <form className="card form" action={saveFacultyAction}>
      <input type="hidden" name="id" value={faculty.id} />
      <label className="field"><span>Code</span><input name="code" defaultValue={faculty.code} required /></label>
      <label className="field"><span>Name</span><input name="name" defaultValue={faculty.name} required /></label>
      <button className="button" type="submit">Save faculty</button>
    </form>
  </>;
}
