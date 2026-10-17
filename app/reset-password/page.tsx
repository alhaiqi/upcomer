import type { Metadata } from "next";
import Link from "next/link";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth";
import { checkResetToken } from "@/lib/password-reset";
import { resetPasswordAction } from "@/lib/password-reset-actions";

export const dynamic = "force-dynamic";
// The token is in this page's URL, so it must never be sent on as a Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

const linkMessages: Record<string, string> = {
  used: "This reset link has already been used.",
  expired: "This reset link has expired or was replaced by a newer one.",
  superseded: "This reset link has expired or was replaced by a newer one.",
  unknown: "This reset link isn't valid.",
  unexpected: "Something went wrong. Please try again.",
};
const passwordMessages: Record<string, string> = {
  weak_password: `Use a password of at least ${PASSWORD_MIN_LENGTH} characters.`,
  password_mismatch: "The two passwords don't match.",
};

function Rejected({ reason }: { reason: string }) {
  return <><h1>Reset Your Password</h1>
    <p className="notice error" role="alert">{linkMessages[reason] ?? linkMessages.unknown}</p>
    <p><Link className="button" href="/forgot-password">Request a new link</Link></p>
  </>;
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = "", error } = await searchParams;
  if (error && !passwordMessages[error]) return <Rejected reason={error} />;
  const check = await checkResetToken(token);
  if (!check.ok) return <Rejected reason={check.reason} />;
  return <><h1>Set a New Password</h1><p className="muted">Choose a new password. All your other sessions will be logged out.</p>
    {error && <p className="notice error" role="alert">{passwordMessages[error]}</p>}
    <form className="card form" action={resetPasswordAction}>
      <input type="hidden" name="token" value={token} />
      <label className="field"><span>New password</span><input type="password" name="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required /></label>
      <label className="field"><span>Confirm new password</span><input type="password" name="confirm" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required /></label>
      <button className="button" type="submit">Set new password</button>
    </form>
  </>;
}
