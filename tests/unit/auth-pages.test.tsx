import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireUser, getMyCourses, signUpAction, logInAction, logOutAction, getCurrentUser } = vi.hoisted(() => ({
  requireUser: vi.fn(), getMyCourses: vi.fn(), signUpAction: vi.fn(), logInAction: vi.fn(), logOutAction: vi.fn(), getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/auth", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/auth")>(), requireUser, getCurrentUser }));
vi.mock("@/lib/my-courses", () => ({ getMyCourses }));
vi.mock("@/lib/auth-actions", () => ({ signUpAction, logInAction, logOutAction }));
import RootLayout from "@/app/layout";
import LoginPage from "@/app/login/page";
import MyCoursesPage from "@/app/my-courses/page";
import SignupPage from "@/app/signup/page";

const searchParams = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });
const student = { id: "user-1", email: "ali@mail.aub.edu", name: "Ali", role: "STUDENT" };
const courses = [
  { id: "course-eece350", code: "EECE350", name: "Computer Networks", faculty: { name: "Faculty of Engineering" }, professors: [{ professor: { name: "Professor A" } }] },
  { id: "course-math201", code: "MATH201", name: "Calculus III", faculty: { name: "Faculty of Arts and Sciences" }, professors: [] },
];

beforeEach(() => {
  for (const mock of [requireUser, getMyCourses, getCurrentUser]) mock.mockReset();
  delete process.env.SIGNUP_EMAIL_DOMAIN;
});

describe("sign-up page", () => {
  it("asks for a name, email and password", async () => {
    const html = renderToStaticMarkup(await SignupPage(searchParams()));
    expect(html).toContain("Create Your Account");
    expect(html).toContain('name="name"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('name="password"');
    expect(html).toContain('minLength="8"');
    expect(html).toContain("Create account");
    expect(html).toContain('href="/login"');
  });
  it.each([
    ["email_taken", "An account with this email already exists."],
    ["weak_password", "Use a password of at least 8 characters."],
    ["invalid_email", "Enter a valid email address."],
    ["name_required", "Enter your name."],
    ["domain_not_allowed", "Use your university email address."],
    ["unexpected", "Something went wrong. Please try again."],
    ["something-else", "Something went wrong. Please try again."],
  ])("shows the %s message", async (error, message) => {
    expect(renderToStaticMarkup(await SignupPage(searchParams({ error })))).toContain(message);
  });
  it("shows no message without an error", async () => {
    expect(renderToStaticMarkup(await SignupPage(searchParams()))).not.toContain("notice");
  });
  it("carries a safe next page into the form and the login link", async () => {
    const html = renderToStaticMarkup(await SignupPage(searchParams({ next: "/courses/course-a" })));
    expect(html).toContain('type="hidden" name="next" value="/courses/course-a"');
    expect(html).toContain("/login?next=%2Fcourses%2Fcourse-a");
  });
  it.each(["//evil.example.com", "https://evil.example.com", "/\\evil.example.com"])("drops the off-site next page %j", async next => {
    const html = renderToStaticMarkup(await SignupPage(searchParams({ next })));
    expect(html).not.toContain("evil.example.com");
    expect(html).toContain('href="/login"');
  });
});

describe("login page", () => {
  it("asks for an email and password", async () => {
    const html = renderToStaticMarkup(await LoginPage(searchParams()));
    expect(html).toContain("Log In");
    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('name="password"');
    expect(html).toContain('href="/signup"');
  });
  it("never says whether the email exists", async () => {
    const html = renderToStaticMarkup(await LoginPage(searchParams({ error: "invalid_credentials" })));
    const alert = html.match(/role="alert">([^<]*)</)?.[1];
    expect(alert).toBe("Invalid email or password.");
    expect(alert).not.toMatch(/not registered|unknown|wrong password|incorrect password|no such/i);
  });
  it("tells a new account to log in", async () => {
    expect(renderToStaticMarkup(await LoginPage(searchParams({ registered: "1" })))).toContain("Account created. Log in to continue.");
  });
  it("carries a safe next page into the form and the sign-up link", async () => {
    const html = renderToStaticMarkup(await LoginPage(searchParams({ next: "/my-courses" })));
    expect(html).toContain('type="hidden" name="next" value="/my-courses"');
    expect(html).toContain("/signup?next=%2Fmy-courses");
  });
  it("drops an off-site next page", async () => {
    expect(renderToStaticMarkup(await LoginPage(searchParams({ next: "//evil.example.com" })))).not.toContain("evil.example.com");
  });
});

describe("My Courses page", () => {
  it("shows the courses the user added", async () => {
    requireUser.mockResolvedValue(student);
    getMyCourses.mockResolvedValue(courses);
    const html = renderToStaticMarkup(await MyCoursesPage());
    expect(html).toContain("My Courses");
    expect(html).toContain("EECE350");
    expect(html).toContain("Computer Networks");
    expect(html).toContain("MATH201");
    expect(html).toContain('href="/courses/course-eece350"');
    expect(getMyCourses).toHaveBeenCalledWith("user-1");
  });
  it("shows an empty state with a way back to the catalog", async () => {
    requireUser.mockResolvedValue(student);
    getMyCourses.mockResolvedValue([]);
    const html = renderToStaticMarkup(await MyCoursesPage());
    expect(html).toContain("You haven&#x27;t added any courses yet.");
    expect(html).toContain("Browse Courses");
  });
  it("is protected in the page itself, not only in the middleware", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /login?next=%2Fmy-courses"));
    await expect(MyCoursesPage()).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fmy-courses");
    expect(getMyCourses).not.toHaveBeenCalled();
  });
  it("lets a failed query reach the error page", async () => {
    requireUser.mockResolvedValue(student);
    getMyCourses.mockRejectedValue(new Error("database down"));
    await expect(MyCoursesPage()).rejects.toThrow("database down");
  });
});

describe("site header", () => {
  it("offers log in and sign up to a visitor", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await RootLayout({ children: null }));
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain("Log out");
    expect(html).not.toContain("My Courses");
  });
  it("offers My Courses and a log-out button to a logged-in user", async () => {
    getCurrentUser.mockResolvedValue(student);
    const html = renderToStaticMarkup(await RootLayout({ children: null }));
    expect(html).toContain('href="/my-courses"');
    expect(html).toContain("Log out");
    expect(html).toContain("<button");
    expect(html).not.toContain('href="/signup"');
  });
  it("logs out with a button, never a link, so a prefetch cannot end the session", async () => {
    getCurrentUser.mockResolvedValue(student);
    const html = renderToStaticMarkup(await RootLayout({ children: null }));
    expect(html).not.toMatch(/<a[^>]*>\s*Log out/);
  });
});
