import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAccount, authenticate, startSession, endSession, requireUser, addCourseToMyCourses, redirect, notFound } = vi.hoisted(() => ({
  createAccount: vi.fn(), authenticate: vi.fn(), startSession: vi.fn(), endSession: vi.fn(), requireUser: vi.fn(),
  addCourseToMyCourses: vi.fn(), redirect: vi.fn(), notFound: vi.fn(),
}));
vi.mock("@/lib/auth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth")>(), createAccount, authenticate, startSession, endSession, requireUser,
}));
vi.mock("@/lib/my-courses", () => ({ addCourseToMyCourses }));
vi.mock("next/navigation", () => ({ redirect, notFound }));
import { logInAction, logOutAction, signUpAction } from "@/lib/auth-actions";
import { addCourseAction } from "@/lib/my-courses-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};
const student = { id: "user-1", email: "ali@mail.aub.edu", name: "Ali", role: "STUDENT" };

beforeEach(() => {
  for (const mock of [createAccount, authenticate, startSession, endSession, requireUser, addCourseToMyCourses]) mock.mockReset();
  redirect.mockReset().mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); });
  notFound.mockReset().mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });
});

describe("sign up", () => {
  it("sends a new account to the login page and does not log it in yet", async () => {
    createAccount.mockResolvedValue({ created: true, user: student });
    await expect(signUpAction(form({ name: "Ali", email: "ali@mail.aub.edu", password: "password123" })))
      .rejects.toThrow("NEXT_REDIRECT /login?registered=1");
    expect(createAccount).toHaveBeenCalledWith({ name: "Ali", email: "ali@mail.aub.edu", password: "password123" });
    expect(startSession).not.toHaveBeenCalled();
  });
  it("keeps a safe next page across sign-up and login", async () => {
    createAccount.mockResolvedValue({ created: true, user: student });
    await expect(signUpAction(form({ name: "Ali", email: "ali@mail.aub.edu", password: "password123", next: "/courses/course-a" })))
      .rejects.toThrow("NEXT_REDIRECT /login?registered=1&next=%2Fcourses%2Fcourse-a");
  });
  it("drops an off-site next page", async () => {
    createAccount.mockResolvedValue({ created: true, user: student });
    await expect(signUpAction(form({ name: "Ali", email: "ali@mail.aub.edu", password: "password123", next: "//evil.example.com" })))
      .rejects.toThrow("NEXT_REDIRECT /login?registered=1");
  });
  it.each(["email_taken", "weak_password", "invalid_email", "name_required", "unexpected"])("shows the %s problem on the sign-up page", async error => {
    createAccount.mockResolvedValue({ created: false, error });
    await expect(signUpAction(form({ name: "", email: "", password: "" }))).rejects.toThrow(`NEXT_REDIRECT /signup?error=${error}`);
  });
});

describe("log in and log out", () => {
  it("starts a session and opens My Courses", async () => {
    authenticate.mockResolvedValue({ user: student });
    await expect(logInAction(form({ email: "ali@mail.aub.edu", password: "password123" }))).rejects.toThrow("NEXT_REDIRECT /my-courses");
    expect(startSession).toHaveBeenCalledWith("user-1");
  });
  it("returns to the page the visitor came from", async () => {
    authenticate.mockResolvedValue({ user: student });
    await expect(logInAction(form({ email: "ali@mail.aub.edu", password: "password123", next: "/courses/course-a" })))
      .rejects.toThrow("NEXT_REDIRECT /courses/course-a");
  });
  it("ignores an off-site next page", async () => {
    authenticate.mockResolvedValue({ user: student });
    await expect(logInAction(form({ email: "ali@mail.aub.edu", password: "password123", next: "https://evil.example.com" })))
      .rejects.toThrow("NEXT_REDIRECT /my-courses");
  });
  it("shows one message for bad credentials and starts no session", async () => {
    authenticate.mockResolvedValue({ error: "invalid_credentials" });
    await expect(logInAction(form({ email: "ali@mail.aub.edu", password: "wrong" }))).rejects.toThrow("NEXT_REDIRECT /login?error=invalid_credentials");
    expect(startSession).not.toHaveBeenCalled();
  });
  it("keeps the next page after a failed login", async () => {
    authenticate.mockResolvedValue({ error: "invalid_credentials" });
    await expect(logInAction(form({ email: "a@b.co", password: "wrong", next: "/courses/course-a" })))
      .rejects.toThrow("NEXT_REDIRECT /login?error=invalid_credentials&next=%2Fcourses%2Fcourse-a");
  });
  it("ends the session and returns to the catalog", async () => {
    await expect(logOutAction()).rejects.toThrow("NEXT_REDIRECT /");
    expect(endSession).toHaveBeenCalled();
  });
});

describe("add to My Courses", () => {
  it("adds the course for the logged-in user and confirms it on the course page", async () => {
    requireUser.mockResolvedValue(student);
    addCourseToMyCourses.mockResolvedValue("added");
    await expect(addCourseAction(form({ courseId: "course-a" }))).rejects.toThrow("NEXT_REDIRECT /courses/course-a?added=1");
    expect(requireUser).toHaveBeenCalledWith("/courses/course-a");
    expect(addCourseToMyCourses).toHaveBeenCalledWith("user-1", "course-a");
  });
  it("says a course is already added instead of failing", async () => {
    requireUser.mockResolvedValue(student);
    addCourseToMyCourses.mockResolvedValue("already_added");
    await expect(addCourseAction(form({ courseId: "course-a" }))).rejects.toThrow("NEXT_REDIRECT /courses/course-a?added=already");
  });
  it("shows not found for a course that does not exist", async () => {
    requireUser.mockResolvedValue(student);
    addCourseToMyCourses.mockResolvedValue("not_found");
    await expect(addCourseAction(form({ courseId: "course-missing" }))).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("checks the session in the action, not only in the middleware", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /login?next=%2Fcourses%2Fcourse-a"));
    await expect(addCourseAction(form({ courseId: "course-a" }))).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fcourses%2Fcourse-a");
    expect(addCourseToMyCourses).not.toHaveBeenCalled();
  });
});
