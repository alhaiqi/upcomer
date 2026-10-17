// Profile rules shared by the server and the browser form (US-04); no database access here.

export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_MAJOR_MAX_LENGTH = 100;

export type ProfileError = "name_required" | "name_too_long" | "major_too_long" | "faculty_not_found" | "unexpected";
export type ProfileValues = { name: string; facultyId: string; major: string };

export function profileMessage(error: string) {
  switch (error) {
    case "name_required": return "Enter your name.";
    case "name_too_long": return `Your name must be ${PROFILE_NAME_MAX_LENGTH} characters or fewer.`;
    case "major_too_long": return `Your major must be ${PROFILE_MAJOR_MAX_LENGTH} characters or fewer.`;
    case "faculty_not_found": return "The selected faculty doesn't exist anymore. Choose another one.";
    default: return "Your profile could not be saved. Please try again.";
  }
}
