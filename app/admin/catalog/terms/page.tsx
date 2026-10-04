import Link from "next/link";
import { CatalogNotice } from "@/components/catalog-notice";
import { requireAdmin } from "@/lib/auth";
import { saveTermAction } from "@/lib/catalog-admin-actions";
import { getCatalogAdminData } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/terms");
  const notice = await searchParams;
  const { terms } = await getCatalogAdminData();
  return <><Link className="back" href="/admin/catalog">← Back to catalog</Link><span className="eyebrow">Admin</span><h1>Terms</h1>
    <CatalogNotice entity="term" {...notice} />
    <form className="card form" action={saveTermAction}>
      <h2>Add a term</h2>
      <label className="field"><span>Name</span><input name="name" placeholder="Fall" required /></label>
      <button className="button" type="submit">Add term</button>
    </form>
    <h2>All terms</h2>
    {terms.length ? <ul className="list catalog-list">{terms.map(term => <li className="card" key={term.id}>
      <h3>{term.name}</h3>
      <Link href={`/admin/catalog/terms/${term.id}`} aria-label={`Edit ${term.name}`}>Edit</Link>
    </li>)}</ul> : <p className="card muted">No terms yet.</p>}
  </>;
}
