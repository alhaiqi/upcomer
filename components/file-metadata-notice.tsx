import { fileMetadataMessage } from "@/lib/file-metadata-rules";

export function FileMetadataNotice({ saved, error }: { saved?: string; error?: string }) {
  if (error) return <p className="notice error" role="alert">{fileMetadataMessage(error)}</p>;
  if (saved) return <p className="notice" role="status">Saved. The file is listed under its course now.</p>;
  return null;
}
