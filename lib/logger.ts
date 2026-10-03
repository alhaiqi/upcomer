type LogEvent =
  | "course_retrieval_failed"
  | "exam_list_retrieval_failed"
  | "material_list_retrieval_failed"
  | "file_record_not_found"
  | "physical_file_not_found"
  | "file_open_failed"
  | "invalid_storage_key"
  | "course_catalog_retrieval_failed"
  | "course_search_failed"
  | "catalog_filter_options_retrieval_failed"
  | "signup_failed"
  | "login_failed"
  | "session_validation_failed"
  | "logout_failed"
  | "unauthorized_access"
  | "my_courses_add_failed"
  | "my_courses_retrieval_failed";

export function logError(event: LogEvent, context: Record<string, string | undefined> = {}) {
  console.error(JSON.stringify({ event, timestamp: new Date().toISOString(), ...context }));
}
