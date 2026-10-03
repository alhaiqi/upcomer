import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "@/middleware";
import { SESSION_COOKIE } from "@/lib/session-cookie";

const location = (response: Response) => {
  const url = response.headers.get("location");
  return url ? new URL(url).pathname + new URL(url).search : null;
};

const request = (path: string, withCookie = false) => {
  const next = new NextRequest(new URL(path, "http://127.0.0.1:3000"));
  if (withCookie) next.cookies.set(SESSION_COOKIE, "raw-token");
  return next;
};

describe("login redirect middleware", () => {
  it("sends a visitor with no session cookie to the login page with the page to come back to", () => {
    const response = middleware(request("/my-courses"));
    expect(response.status).toBe(307);
    expect(location(response)).toBe("/login?next=%2Fmy-courses");
  });
  it("keeps the query string of the page the visitor wanted", () => {
    const response = middleware(request("/admin/uploads?category=EXAM"));
    expect(location(response)).toBe("/login?next=%2Fadmin%2Fuploads%3Fcategory%3DEXAM");
  });
  it("lets a request with a session cookie through, leaving the real check to the page", () => {
    const response = middleware(request("/my-courses", true));
    expect(location(response)).toBeNull();
  });
  it("covers My Courses and the admin area only, so browsing stays open", () => {
    expect(config.matcher).toEqual(["/my-courses", "/my-courses/:path*", "/admin", "/admin/:path*"]);
  });
});
