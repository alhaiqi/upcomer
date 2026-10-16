// Prisma passes `contains`, `startsWith` and `endsWith` text straight into a LIKE/ILIKE pattern, where `%` and `_` are
// wildcards and `\` is the escape character. Escape all three so search text is matched literally.
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");
