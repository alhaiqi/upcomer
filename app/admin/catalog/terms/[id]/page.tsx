import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogNotice } from "@/components/catalog-notice";
import { requireAdmin } from "@/lib/auth";
import { saveTermAction } from "@/lib/catalog-admin-actions";
import { getTerm } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function EditTermPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/terms");
  const [{ id }, notice] = await Promise.all([params, searchParams]);
  const term = await getTerm(id);
  if (!term) notFound();
  return <><Link className="back" href="/admin/catalog/terms">← Back to terms</Link><span className="eyebrow">Admin</span><h1>Edit Term</h1>
    <CatalogNotice entity="term" {...notice} />
    <form className="card form" action={saveTermAction}>
      <input type="hidden" name="id" value={term.id} />
      <label className="field"><span>Name</span><input name="name" defaultValue={term.name} required /></label>
      <button className="button" type="submit">Save term</button>
    </form>
  </>;
}
