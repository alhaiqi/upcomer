"use client";

import { useActionState } from "react";
import { PROFILE_MAJOR_MAX_LENGTH, PROFILE_NAME_MAX_LENGTH, profileMessage, type ProfileValues } from "@/lib/profile-rules";
import type { ProfileFormState } from "@/lib/profile-actions";

type Action = (previous: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;

// A plain POST to a server action, so it works without JavaScript. The server checks every rule again.
export function ProfileForm({ action, email, faculties, saved }: {
  action: Action; email: string; faculties: { id: string; name: string }[]; saved: ProfileValues;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  // After a refusal the form shows what was typed; otherwise the saved profile.
  const values = state.values ?? saved;
  const nameError = state.error === "name_required" || state.error === "name_too_long";
  const majorError = state.error === "major_too_long";
  const facultyError = state.error === "faculty_not_found";

  return <form className="card form" action={formAction}>
    {state.status === "error" && state.error && <p className="notice error" role="alert" id="profile-error">{profileMessage(state.error)}</p>}
    {state.status === "saved" && <p className="form-success" role="status">Profile saved.</p>}
    <div className="field"><span>Email</span><p className="muted field-value">{email}</p></div>
    {/* key: a refused save re-renders the fields with what was typed, even after React resets the form. */}
    <label className="field" key={`name-${values.name}`}><span>Name</span>
      <input name="name" autoComplete="name" required maxLength={PROFILE_NAME_MAX_LENGTH} defaultValue={values.name}
        aria-invalid={nameError || undefined} aria-describedby={nameError ? "profile-error" : undefined} />
    </label>
    <label className="field" key={`faculty-${values.facultyId}`}><span>Faculty (optional)</span>
      <select name="facultyId" defaultValue={values.facultyId} aria-invalid={facultyError || undefined} aria-describedby={facultyError ? "profile-error" : undefined}>
        <option value="">Not specified</option>
        {faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
      </select>
    </label>
    <label className="field" key={`major-${values.major}`}><span>Major (optional)</span>
      <input name="major" maxLength={PROFILE_MAJOR_MAX_LENGTH} placeholder="Computer Engineering" defaultValue={values.major}
        aria-invalid={majorError || undefined} aria-describedby={majorError ? "profile-error" : undefined} />
    </label>
    <button className="button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
  </form>;
}
