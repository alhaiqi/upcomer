import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getCatalogAdminData } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function CatalogAdminPage() {
  await requireAdmin("/admin/catalog");
  const { faculties, courses, professors, terms } = await getCatalogAdminData();
  const sections = [
    { href: "/admin/catalog/faculties", title: "Faculties", count: faculties.length, text: "Faculties group courses in the catalog filters." },
    { href: "/admin/catalog/courses", title: "Courses", count: courses.length, text: "Course codes, names, faculties, and professors." },
    { href: "/admin/catalog/professors", title: "Professors", count: professors.length, text: "Professors can be assigned to courses and uploads." },
    { href: "/admin/catalog/terms", title: "Terms", count: terms.length, text: "The terms content can be organized by." },
  ];
  return <><span className="eyebrow">Admin</span><h1>Manage Catalog</h1><p className="muted">Add and edit what students see in the course catalog. Changes appear straight away.</p>
    <div className="grid">
      {sections.map(section => <section className="card" key={section.href}>
        <h2>{section.title}</h2><p className="muted">{section.count} {section.count === 1 ? "entry" : "entries"}. {section.text}</p>
        <Link className="button" href={section.href}>Manage {section.title.toLowerCase()}</Link>
      </section>)}
      <section className="card"><h2>Uploads</h2><p className="muted">Add previous exams and course materials.</p><Link className="button" href="/admin/uploads">Upload content</Link></section>
    </div>
  </>;
}
