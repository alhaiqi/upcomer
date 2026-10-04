"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { saveCourse, saveFaculty, saveProfessor, saveTerm, type SaveResult } from "@/lib/catalog-admin";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

// Success returns to the list; a failure returns to the form it came from, with the reason and the offending code or name.
function finish(section: string, id: string, result: SaveResult): never {
  const list = `/admin/catalog/${section}`;
  if (result.ok) redirect(`${list}?saved=1`);
  if (result.error === "not_found") redirect(`${list}?error=not_found`);
  const params = new URLSearchParams({ error: result.error, ...(result.value ? { value: result.value } : {}) });
  redirect(`${id ? `${list}/${encodeURIComponent(id)}` : list}?${params}`);
}

export async function saveFacultyAction(formData: FormData) {
  await requireAdmin("/admin/catalog/faculties");
  const id = field(formData, "id");
  finish("faculties", id, await saveFaculty({ id: id || undefined, code: field(formData, "code"), name: field(formData, "name") }));
}

export async function saveCourseAction(formData: FormData) {
  await requireAdmin("/admin/catalog/courses");
  const id = field(formData, "id");
  finish("courses", id, await saveCourse({
    id: id || undefined, code: field(formData, "code"), name: field(formData, "name"), facultyId: field(formData, "facultyId"),
    professorIds: formData.getAll("professorIds").map(String),
  }));
}

export async function saveProfessorAction(formData: FormData) {
  await requireAdmin("/admin/catalog/professors");
  const id = field(formData, "id");
  finish("professors", id, await saveProfessor({ id: id || undefined, name: field(formData, "name") }));
}

export async function saveTermAction(formData: FormData) {
  await requireAdmin("/admin/catalog/terms");
  const id = field(formData, "id");
  finish("terms", id, await saveTerm({ id: id || undefined, name: field(formData, "name") }));
}
