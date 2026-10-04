import Link from "next/link";
import { CatalogNotice } from "@/components/catalog-notice";
import { requireAdmin } from "@/lib/auth";
import { saveFacultyAction } from "@/lib/catalog-admin-actions";
import { getCatalogAdminData } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function FacultiesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/faculties");
  const notice = await searchParams;
  const { faculties } = await getCatalogAdminData();
  return <><Link className="back" href="/admin/catalog">← Back to catalog</Link><span className="eyebrow">Admin</span><h1>Faculties</h1>
    <CatalogNotice entity="faculty" {...notice} />
    <form className="card form" action={saveFacultyAction}>
      <h2>Add a faculty</h2>
      <label className="field"><span>Code</span><input name="code" placeholder="ENG" required /></label>
      <label className="field"><span>Name</span><input name="name" placeholder="Faculty of Engineering" required /></label>
      <button className="button" type="submit">Add faculty</button>
    </form>
    <h2>All faculties</h2>
    {faculties.length ? <ul className="list catalog-list">{faculties.map(faculty => <li className="card" key={faculty.id}>
      <span className="eyebrow">{faculty.code}</span><h3>{faculty.name}</h3>
      <Link href={`/admin/catalog/faculties/${faculty.id}`} aria-label={`Edit ${faculty.name}`}>Edit</Link>
    </li>)}</ul> : <p className="card muted">No faculties yet.</p>}
  </>;
}
