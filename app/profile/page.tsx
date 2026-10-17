import { ProfileForm } from "@/components/profile-form";
import { requireUser } from "@/lib/auth";
import { getFacultyOptions, getProfile } from "@/lib/profile";
import { saveProfileAction } from "@/lib/profile-actions";

export const dynamic = "force-dynamic";

// The logged-in user's own profile (US-04). Whose profile it is comes from the session only.
export default async function ProfilePage() {
  const user = await requireUser("/profile");
  const [profile, faculties] = await Promise.all([getProfile(user.id), getFacultyOptions()]);
  const saved = { name: profile?.name ?? user.name, facultyId: profile?.facultyId ?? "", major: profile?.major ?? "" };
  return <><h1>My Profile</h1>
    <p className="muted">Keep your name, faculty, and major up to date.</p>
    <ProfileForm action={saveProfileAction} email={profile?.email ?? user.email} faculties={faculties} saved={saved} />
  </>;
}
