import Link from "next/link";
import { PASSWORD_MIN_LENGTH, safeNext } from "@/lib/auth";
import { signUpAction } from "@/lib/auth-actions";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  name_required: "Enter your name.",
  invalid_email: "Enter a valid email address.",
  domain_not_allowed: "Use your university email address.",
  weak_password: `Use a password of at least ${PASSWORD_MIN_LENGTH} characters.`,
  email_taken: "An account with this email already exists.",
  unexpected: "Something went wrong. Please try again.",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next: requestedNext } = await searchParams;
  const next = safeNext(requestedNext, "");
  return <><h1>Create Your Account</h1><p className="muted">Sign up to keep the courses you follow in one place.</p>
    {error && <p className="notice error" role="alert">{messages[error] ?? messages.unexpected}</p>}
    <form className="card form" action={signUpAction}>
      {next && <input type="hidden" name="next" value={next} />}
      <label className="field"><span>Name</span><input name="name" autoComplete="name" required /></label>
      <label className="field"><span>Email</span><input type="email" name="email" autoComplete="email" required /></label>
      <label className="field"><span>Password</span><input type="password" name="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required /></label>
      <button className="button" type="submit">Create account</button>
    </form>
    <p className="muted">Already have an account? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Log in</Link>.</p>
  </>;
}
