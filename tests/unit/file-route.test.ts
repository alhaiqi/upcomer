import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOriginalFile } = vi.hoisted(() => ({ getOriginalFile: vi.fn() }));
vi.mock("@/lib/files", () => ({
  getOriginalFile,
  FileUnavailableError: class FileUnavailableError extends Error {},
}));
import { GET } from "@/app/files/[fileId]/route";

const context = { params: Promise.resolve({ fileId: "file-a" }) };
beforeEach(() => getOriginalFile.mockReset());

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
});
