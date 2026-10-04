import { FileUnavailableError, getOriginalFile } from "@/lib/files";
import { errorCode, logError } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  try {
    const { record, bytes } = await getOriginalFile(fileId);
    const safeName = record.originalFileName.replace(/[^\x20-\x7E]|["\\/;]/g, "_");
    const mimeType = record.mimeType || "application/octet-stream";
    const disposition = mimeType === "application/pdf" ? "inline" : "attachment";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${disposition}; filename="${safeName}"`,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof FileUnavailableError) {
      return new Response("File unavailable", { status: 404 });
    }
    logError("file_open_failed", { fileId, errorType: error instanceof Error ? error.name : "Unknown", errorCode: errorCode(error) });
    return new Response("File unavailable", { status: 500 });
  }
}
