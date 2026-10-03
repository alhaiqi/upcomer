export const SESSION_COOKIE = "upcomer_session";
export const SESSION_TTL_DAYS = 7;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export function safeNext(next?: string | null, fallback = "/my-courses") {
  return next && /^\/(?![/\\])[^\s]*$/.test(next) ? next : fallback;
}
