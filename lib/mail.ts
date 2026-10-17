// Sending email (US-03). No Next.js imports, so the e2e tests can load it.
//
// A provider is plugged in with three env vars: MAIL_API_URL, MAIL_API_KEY, and MAIL_FROM. Mail is sent as one JSON POST
// { from, to, subject, text } with "Authorization: Bearer <MAIL_API_KEY>", the shape of Resend's API
// (https://api.resend.com/emails); other HTTP mail APIs take the same fields or need only a small change here.
// Without a provider, development prints the message to the server terminal, marked as dev-only. Everywhere else nothing is
// printed and sendMail throws, because a message may hold a secret such as a reset link. Never route it through logError.

export type Mail = { to: string; subject: string; text: string };

export class MailError extends Error {
  constructor(public reason: "not_configured" | "provider_rejected" | "provider_unreachable", public status?: number) { super(reason); }
}

const SEND_TIMEOUT_MS = 10_000;
const isDevelopment = () => process.env.NODE_ENV === "development";

function provider() {
  const url = process.env.MAIL_API_URL?.trim();
  const key = process.env.MAIL_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  return url && key && from ? { url, key, from } : null;
}

// The site's own address for links in emails. Never taken from the request's Host header, which a client can forge.
export function appOrigin() {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return isDevelopment() ? "http://localhost:3000" : null;
}

export async function sendMail(mail: Mail, fetcher: typeof fetch = fetch) {
  const config = provider();
  if (!config) {
    if (!isDevelopment()) throw new MailError("not_configured");
    console.info(["", "==== DEV ONLY: email not sent (no mail provider configured) ====", `To: ${mail.to}`, `Subject: ${mail.subject}`, "", mail.text, "==== END DEV ONLY ====", ""].join("\n"));
    return;
  }
  let response: Response;
  try {
    response = await fetcher(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ from: config.from, to: mail.to, subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    throw new MailError("provider_unreachable");
  }
  if (!response.ok) throw new MailError("provider_rejected", response.status);
}
