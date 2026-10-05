import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOriginalFile, FileUnavailableError } = vi.hoisted(() => ({
  getOriginalFile: vi.fn(),
  FileUnavailableError: class FileUnavailableError extends Error {
    constructor(public reason: string, public courseId?: string) { super(reason); }
  },
}));
vi.mock("@/lib/files", () => ({ getOriginalFile, FileUnavailableError }));
import { GET } from "@/app/files/[fileId]/route";

const context = { params: Promise.resolve({ fileId: "file-a" }) };
// A block body: a function returned from beforeEach would run as teardown and call the mock again.
beforeEach(() => { getOriginalFile.mockReset(); });

describe("original file route", () => {
  it("returns original bytes and PDF headers", async () => {
    const bytes = Buffer.from("%PDF-1.4\nexample");
    getOriginalFile.mockResolvedValue({ record: { originalFileName: "exam.pdf", mimeType: "application/pdf" }, bytes });
    const response = await GET(new Request("http://localhost/files/file-a"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
  it("downloads non-PDF files", async () => {
    getOriginalFile.mockResolvedValue({ record: { originalFileName: "notes.html", mimeType: "text/html" }, bytes: Buffer.from("<p>notes</p>") });
    const response = await GET(new Request("http://localhost/files/file-a"), context);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("shows a styled 404 page linking back to the course when the file is missing", async () => {
    getOriginalFile.mockRejectedValue(new FileUnavailableError("missing_file", "course-math201"));
    const response = await GET(new Request("http://localhost/files/file-a"), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("<h1>File unavailable</h1>");
    expect(html).toContain("isn't available right now");
    expect(html).toContain('<a href="/courses/course-math201">Back to the course</a>');
  });
  it("links to the catalog when the file record is unknown", async () => {
    getOriginalFile.mockRejectedValue(new FileUnavailableError("missing_record"));
    const response = await GET(new Request("http://localhost/files/file-a"), context);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('<a href="/">Browse courses</a>');
    expect(html).not.toContain("file-a");
  });
  it("shows a 500 page without error details when the file cannot be read", async () => {
    getOriginalFile.mockRejectedValue(Object.assign(new Error("EISDIR: illegal operation on a directory, read 'C:\\private\\exams'"), { code: "EISDIR", courseId: "course-math201" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(new Request("http://localhost/files/file-a"), context);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain('<a href="/courses/course-math201">Back to the course</a>');
    expect(html).not.toMatch(/EISDIR|private|exams/);
  });
  it("encodes the course ID in the link", async () => {
    getOriginalFile.mockRejectedValue(new FileUnavailableError("missing_file", 'x"><script>'));
    const html = await (await GET(new Request("http://localhost/files/file-a"), context)).text();
    expect(html).toContain('href="/courses/x%22%3E%3Cscript%3E"');
    expect(html).not.toContain("<script>");
  });
});
