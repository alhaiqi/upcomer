import Link from "next/link";
import { safeNext } from "@/lib/auth";
import { logInAction } from "@/lib/auth-actions";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  invalid_credentials: "Invalid email or password.",
  unexpected: "Something went wrong. Please try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; registered?: string }> }) {
  const { error, next: requestedNext, registered } = await searchParams;
  const next = safeNext(requestedNext, "");
  return <><h1>Log In</h1><p className="muted">Log in to open My Courses.</p>
    {registered && <p className="notice" role="status">Account created. Log in to continue.</p>}
    {error && <p className="notice error" role="alert">{messages[error] ?? messages.unexpected}</p>}
    <form className="card form" action={logInAction}>
      {next && <input type="hidden" name="next" value={next} />}
      <label className="field"><span>Email</span><input type="email" name="email" autoComplete="email" required /></label>
      <label className="field"><span>Password</span><input type="password" name="password" autoComplete="current-password" required /></label>
      <button className="button" type="submit">Log in</button>
    </form>
    <p className="muted">No account yet? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>Create one</Link>.</p>
  </>;
}
