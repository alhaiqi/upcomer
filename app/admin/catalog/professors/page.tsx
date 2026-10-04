import Link from "next/link";
import { CatalogNotice } from "@/components/catalog-notice";
import { requireAdmin } from "@/lib/auth";
import { saveProfessorAction } from "@/lib/catalog-admin-actions";
import { getCatalogAdminData } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ProfessorsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/professors");
  const notice = await searchParams;
  const { professors } = await getCatalogAdminData();
  return <><Link className="back" href="/admin/catalog">← Back to catalog</Link><span className="eyebrow">Admin</span><h1>Professors</h1>
    <CatalogNotice entity="professor" {...notice} />
    <form className="card form" action={saveProfessorAction}>
      <h2>Add a professor</h2>
      <label className="field"><span>Name</span><input name="name" placeholder="Professor A" required /></label>
      <button className="button" type="submit">Add professor</button>
    </form>
    <h2>All professors</h2>
    {professors.length ? <ul className="list catalog-list">{professors.map(professor => <li className="card" key={professor.id}>
      <h3>{professor.name}</h3>
      <Link href={`/admin/catalog/professors/${professor.id}`} aria-label={`Edit ${professor.name}`}>Edit</Link>
    </li>)}</ul> : <p className="card muted">No professors yet.</p>}
  </>;
}
