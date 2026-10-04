import type { CatalogEntity } from "@/lib/catalog-admin";

const invalidFields: Record<CatalogEntity, string> = {
  faculty: "Enter a faculty code of 2 to 20 letters or digits and a name.",
  course: "Enter a course code of 2 to 20 letters or digits, a name, and choose a faculty.",
  professor: "Enter the professor's name.",
  term: "Enter a term name.",
};

export function catalogErrorMessage(entity: CatalogEntity, error: string, value = "") {
  switch (error) {
    case "invalid_fields": return invalidFields[entity];
    case "duplicate_code": return `A ${entity} with code ${value} already exists.`;
    case "duplicate_name": return `A ${entity} named “${value}” already exists.`;
    case "unknown_faculty": return "The selected faculty doesn't exist.";
    case "unknown_professor": return "One of the selected professors doesn't exist.";
    case "not_found": return `That ${entity} doesn't exist anymore.`;
    default: return "Something went wrong. Please try again.";
  }
}

export function CatalogNotice({ entity, saved, error, value }: { entity: CatalogEntity; saved?: string; error?: string; value?: string }) {
  if (error) return <p className="notice error" role="alert">{catalogErrorMessage(entity, error, value)}</p>;
  if (saved) return <p className="notice" role="status">Saved. The catalog shows the change now.</p>;
  return null;
}
