type LogEvent =
  | "course_retrieval_failed"
  | "exam_list_retrieval_failed"
  | "material_list_retrieval_failed"
  | "file_record_not_found"
  | "physical_file_not_found"
  | "file_open_failed"
  | "invalid_storage_key"
  | "upload_rejected"
  | "upload_storage_failed"
  | "upload_record_failed"
  | "upload_cleanup_failed"
  | "upload_failed"
  | "upload_options_retrieval_failed";

export function logError(event: LogEvent, context: Record<string, string | undefined> = {}) {
  console.error(JSON.stringify({ event, timestamp: new Date().toISOString(), ...context }));
}
