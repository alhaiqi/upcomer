// Shared by the server upload service and the browser form, so it must not import Node modules.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "20 MB";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

export const UPLOAD_FILE_TYPES: Record<string, { mimeType: string; signature: number[] }> = {
  pdf: { mimeType: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signature: ZIP_SIGNATURE },
  pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", signature: ZIP_SIGNATURE },
  png: { mimeType: "image/png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpg: { mimeType: "image/jpeg", signature: JPEG_SIGNATURE },
  jpeg: { mimeType: "image/jpeg", signature: JPEG_SIGNATURE },
};

export const UPLOAD_ACCEPT = Object.keys(UPLOAD_FILE_TYPES).map(extension => `.${extension}`).join(",");
export const UPLOAD_TYPES_LABEL = "PDF, DOCX, PPTX, PNG, or JPG";
