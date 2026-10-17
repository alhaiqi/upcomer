import Link from "next/link";
import { RESET_SENT_MESSAGE } from "@/lib/password-reset";
import { requestResetAction } from "@/lib/password-reset-actions";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return <><h1>Reset Your Password</h1><p className="muted">Enter the email you signed up with, and we&apos;ll send you a link to set a new password.</p>
    {sent && <p className="notice" role="status">{RESET_SENT_MESSAGE}</p>}
    <form className="card form" action={requestResetAction}>
      <label className="field"><span>Email</span><input type="email" name="email" autoComplete="email" required /></label>
      <button className="button" type="submit">Send reset link</button>
    </form>
    <p className="muted">Remembered it? <Link href="/login">Log in</Link>.</p>
  </>;
}
