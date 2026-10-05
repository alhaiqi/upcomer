import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, type Reply } from "../client";
import { result, type Context, type Feature } from "../context";
import { storageRoot } from "../data";

// Search, course pages, exam and material lists, and opening files, checked against what the database says.

type CatalogCourse = { id: string; code: string; name: string; facultyId: string; professorIds: string[] };

async function catalog(ctx: Context): Promise<CatalogCourse[]> {
  const courses = await ctx.db.course.findMany({ select: { id: true, code: true, name: true, facultyId: true, professors: { select: { professorId: true } } } });
  return courses.map(({ professors, ...course }) => ({ ...course, professorIds: professors.map(item => item.professorId) }));
}

// The documented search rule, written independently of the app: a case-insensitive match on the code (with or
// without the query's spaces) or the name, narrowed by faculty and professor.
function expectedMatches(courses: CatalogCourse[], filters: { q: string; facultyId: string; professorId: string }) {
  const q = filters.q.trim().toLowerCase();
  return courses.filter(course => {
    const code = course.code.toLowerCase();
    const matchesQuery = !q || code.includes(q) || code.includes(q.replace(/\s+/g, "")) || course.name.toLowerCase().includes(q);
    return matchesQuery && (!filters.facultyId || course.facultyId === filters.facultyId) && (!filters.professorId || course.professorIds.includes(filters.professorId));
  }).map(course => course.id);
}

const courseLinks = (html: string) => [...html.matchAll(/href="\/courses\/([^"/?]+)"/g)].map(match => decodeURIComponent(match[1]));
const fileLinks = (html: string) => [...html.matchAll(/href="\/files\/([^"/?]+)"/g)].map(match => decodeURIComponent(match[1]));
const totalPages = (html: string) => Number(html.match(/Page (?:<!-- -->)?\d+(?:<!-- -->)? of (?:<!-- -->)?(\d+)/)?.[1] ?? 1);
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

// Fetches every results page and returns the course IDs listed.
async function search(ctx: Context, filters: { q: string; facultyId: string; professorId: string }) {
  const client = ctx.client();
  const params = (page: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), page: String(page) });
  const first = await client.get(`/?${params(1)}`);
  const replies: Reply[] = [first];
  for (let page = 2; first.status === 200 && page <= totalPages(first.body); page++) replies.push(await client.get(`/?${params(page)}`));
  const failed = replies.find(reply => reply.status !== 200);
  return { failed, ids: replies.flatMap(reply => courseLinks(reply.body)), ms: first.ms };
}

function searchTrial(name: string, valid: boolean, input: string, makeFilters: (ctx: Context, courses: CatalogCourse[]) => Promise<{ q: string; facultyId: string; professorId: string }>) {
  return {
    name, valid,
    async run(ctx: Context) {
      const courses = await catalog(ctx);
      const filters = await makeFilters(ctx, courses);
      const expected = expectedMatches(courses, filters);
      const { failed, ids, ms } = await search(ctx, filters);
      const missing = expected.filter(id => !ids.includes(id)).length;
      const extra = ids.filter(id => !expected.includes(id)).length;
      return result(`${input} — ${JSON.stringify(filters)}`, `200 listing exactly the ${expected.length} matching course(s)`,
        failed ? describe(failed) : `200 listing ${ids.length} course(s): ${missing} missing, ${extra} unexpected`,
        !failed && sameSet(ids, expected), ms);
    },
  };
}

const noFilters = { q: "", facultyId: "", professorId: "" };
const fragment = (ctx: Context, text: string) => {
  const start = ctx.rng.int(0, Math.max(0, text.length - 2));
  return ctx.rng.mixCase(text.slice(start, start + ctx.rng.int(1, text.length - start)));
};

export const searchFeature: Feature = {
  name: "Search courses",
  trials: [
    searchTrial("code fragment", true, "part of a course code, random case", async (ctx, courses) => ({ ...noFilters, q: fragment(ctx, ctx.rng.pick(courses).code) })),
    searchTrial("spaced code", true, "a full code with a space inserted, random case", async (ctx, courses) => {
      const code = ctx.rng.pick(courses).code;
      const split = ctx.rng.int(1, Math.max(1, code.length - 1));
      return { ...noFilters, q: ctx.rng.mixCase(`${code.slice(0, split)} ${code.slice(split)}`) };
    }),
    searchTrial("name fragment", true, "part of a course name, random case", async (ctx, courses) => ({ ...noFilters, q: fragment(ctx, ctx.rng.pick(courses).name) })),
    searchTrial("no match", true, "random letters that match nothing", async ctx => ({ ...noFilters, q: `zq${ctx.rng.letters(ctx.rng.int(6, 12))}` })),
    searchTrial("special characters", true, "SQL wildcards, quotes and markup taken literally", async ctx => ({
      ...noFilters, q: ctx.rng.pick(["%", "_", "%%", "a_b", "' OR '1'='1", "\"; DROP TABLE", "<script>", "\\", "100%", "e%e"]),
    })),
    searchTrial("faculty filter", true, "a random faculty", async ctx => ({ ...noFilters, facultyId: ctx.rng.pick(await ctx.db.faculty.findMany({ select: { id: true } })).id })),
    searchTrial("professor filter", true, "a random professor", async ctx => ({ ...noFilters, professorId: ctx.rng.pick(await ctx.db.professor.findMany({ select: { id: true } })).id })),
    searchTrial("combined filters", true, "a code fragment plus a faculty and a professor", async (ctx, courses) => {
      const course = ctx.rng.pick(courses);
      const professors = await ctx.db.professor.findMany({ select: { id: true } });
      return { q: fragment(ctx, course.code), facultyId: ctx.rng.chance(0.7) ? course.facultyId : ctx.rng.pick(courses).facultyId, professorId: ctx.rng.chance(0.5) ? ctx.rng.pick(professors).id : "" };
    }),
    searchTrial("unknown filter", false, "a faculty or professor ID that does not exist", async ctx => (
      ctx.rng.chance(0.5) ? { ...noFilters, facultyId: ctx.rng.letters(25) } : { ...noFilters, professorId: ctx.rng.letters(25) }
    )),
    searchTrial("everything", true, "no query and no filters", async () => noFilters),
  ],
};

const unknownId = (ctx: Context) => ctx.rng.pick([`${ctx.stamp.toLowerCase()}-${ctx.rng.letters(8)}`, ctx.rng.letters(300), "null", "0", "%20"]);

export const coursePageFeature: Feature = {
  name: "Course page",
  trials: [
    {
      name: "existing course", valid: true,
      async run(ctx) {
        const course = ctx.rng.pick(await ctx.db.course.findMany({ select: { id: true } }));
        const reply = await ctx.client().get(`/courses/${course.id}`);
        const ok = reply.status === 200 && reply.body.includes(`href="/courses/${course.id}/exams"`) && reply.body.includes(`href="/courses/${course.id}/materials"`);
        return result("a random existing course ID", "200 with links to its exams and materials", `${describe(reply)}${reply.status === 200 && !ok ? ", links missing" : ""}`, ok, reply.ms);
      },
    },
    {
      name: "unknown course", valid: false,
      async run(ctx) {
        const reply = await ctx.client().get(`/courses/${unknownId(ctx)}`);
        return result("a course ID that does not exist (random, very long, or odd)", "404", describe(reply), reply.status === 404, reply.ms);
      },
    },
  ],
};

function listTrial(category: "EXAM" | "MATERIAL") {
  const segment = category === "EXAM" ? "exams" : "materials";
  return {
    name: `${segment} of an existing course`, valid: true,
    async run(ctx: Context) {
      const course = ctx.rng.pick(await ctx.db.course.findMany({ select: { id: true } }));
      const expected = (await ctx.db.courseFile.findMany({ where: { courseId: course.id, category }, select: { id: true } })).map(file => file.id);
      const reply = await ctx.client().get(`/courses/${course.id}/${segment}`);
      const listed = fileLinks(reply.body);
      const foreign = listed.filter(id => !expected.includes(id)).length;
      return result(`/courses/<random course>/${segment}`, `200 listing exactly the course's ${expected.length} ${segment} file(s)`,
        reply.status === 200 ? `200 listing ${listed.length}: ${expected.filter(id => !listed.includes(id)).length} missing, ${foreign} from elsewhere` : describe(reply),
        reply.status === 200 && sameSet(listed, expected), reply.ms);
    },
  };
}

export const resourceListsFeature: Feature = {
  name: "Exam and material lists",
  trials: [
    listTrial("EXAM"),
    listTrial("MATERIAL"),
    {
      name: "unknown course", valid: false,
      async run(ctx) {
        const segment = ctx.rng.pick(["exams", "materials"]);
        const reply = await ctx.client().get(`/courses/${unknownId(ctx)}/${segment}`);
        return result(`/courses/<unknown>/${segment}`, "404", describe(reply), reply.status === 404, reply.ms);
      },
    },
  ],
};

// Text that must never appear in a refused file response.
const SECRETS = ["DATABASE_URL", "\"name\": \"upcomer\"", "[fonts]", "root:x:0:0"];
const leaks = (reply: Reply) => SECRETS.some(secret => reply.body.includes(secret));

export const openFileFeature: Feature = {
  name: "Open file",
  trials: [
    {
      name: "valid file", valid: true,
      async run(ctx) {
        const files = await ctx.db.courseFile.findMany({ where: { storageKey: { not: { startsWith: "." } } }, select: { id: true, storageKey: true, mimeType: true } });
        const available = [];
        for (const file of files) {
          const filePath = path.join(storageRoot(), file.storageKey);
          if (filePath.startsWith(storageRoot() + path.sep) && (await stat(filePath).catch(() => null))?.isFile()) available.push({ ...file, filePath });
        }
        const file = ctx.rng.pick(available);
        const reply = await ctx.client().get(`/files/${encodeURIComponent(file.id)}`);
        const sameBytes = reply.status === 200 && reply.bytes.equals(await readFile(file.filePath));
        const type = file.mimeType || "application/octet-stream";
        return result("a record whose stored file exists", `200, type ${type}, the stored bytes`,
          `${describe(reply)}, type ${reply.contentType}, bytes ${sameBytes ? "identical" : "different"}`, sameBytes && reply.contentType === type, reply.ms);
      },
    },
    {
      name: "missing file", valid: false,
      async run(ctx) {
        const id = ctx.rng.pick([ctx.fixtures.missingFileId, "file-missing"]);
        const reply = await ctx.client().get(`/files/${id}`);
        return result("a record whose stored file is missing", "404 page", describe(reply), reply.status === 404 && reply.contentType.startsWith("text/html"), reply.ms);
      },
    },
    {
      name: "unknown id", valid: false,
      async run(ctx) {
        const reply = await ctx.client().get(`/files/${encodeURIComponent(unknownId(ctx))}`);
        return result("a file ID with no record", "404", describe(reply), reply.status === 404, reply.ms);
      },
    },
    {
      name: "path traversal", valid: false,
      async run(ctx) {
        const viaUrl = ctx.rng.chance(0.5);
        const target = viaUrl
          ? ctx.rng.pick(["..%2F..%2F.env", "%2e%2e%2f%2e%2e%2fpackage.json", "..%5C..%5C.env", "....%2F%2F.env", "%2Fetc%2Fpasswd", "C%3A%5CWindows%5Cwin.ini"])
          : ctx.rng.pick(ctx.fixtures.unsafeFileIds);
        const reply = await ctx.client().get(`/files/${target}`);
        const refused = reply.status >= 400 && reply.status < 500;
        return result(viaUrl ? "a traversal sequence in the URL" : "a record whose storage key leaves the upload folder",
          "refused (4xx) and no file contents", `${describe(reply)}${leaks(reply) ? ", LEAKED file contents" : ""}`, refused && !leaks(reply), reply.ms);
      },
    },
  ],
};
