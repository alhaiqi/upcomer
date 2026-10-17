// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

const { requireUser, getProfile, getFacultyOptions, saveProfile, revalidatePath, notFound, redirect, logError } = vi.hoisted(() => ({
  requireUser: vi.fn(), getProfile: vi.fn(), getFacultyOptions: vi.fn(), saveProfile: vi.fn(), revalidatePath: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }), redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); }), logError: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/profile", () => ({ getProfile, getFacultyOptions, saveProfile }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/lib/logger", () => ({ logError }));
import ProfilePage from "@/app/profile/page";
import ProfileByIdPage from "@/app/profile/[...path]/page";
import { ProfileForm } from "@/components/profile-form";
import { saveProfileAction, type ProfileFormState } from "@/lib/profile-actions";

const student = { id: "user-a", role: "STUDENT", name: "Lina Haddad", email: "lina@mail.aub.edu" };
const faculties = [{ id: "faculty-arts", name: "Arts and Sciences" }, { id: "faculty-eng", name: "Engineering" }];
const saved = { name: "Lina Haddad", facultyId: "faculty-eng", major: "Computer Engineering" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

beforeEach(() => {
  for (const mock of [requireUser, getProfile, getFacultyOptions, saveProfile, revalidatePath, notFound, redirect, logError]) mock.mockClear();
  requireUser.mockReset().mockResolvedValue(student);
  getProfile.mockReset().mockResolvedValue({ ...saved, id: "user-a", email: student.email });
  getFacultyOptions.mockReset().mockResolvedValue(faculties);
  saveProfile.mockReset().mockImplementation(async (_id, values) => ({ ok: true, values }));
});

afterEach(cleanup);

describe("profile page", () => {
  it("needs a login and shows the session user's saved profile", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    expect(requireUser).toHaveBeenCalledWith("/profile");
    expect(getProfile).toHaveBeenCalledWith("user-a");
    expect(html).toContain("My Profile");
    expect(html).toContain("lina@mail.aub.edu");
    expect(html).toContain('value="Lina Haddad"');
    expect(html).toContain('<option value="faculty-eng" selected="">Engineering</option>');
    expect(html).toContain('<option value="">Not specified</option>');
    expect(html).toContain('value="Computer Engineering"');
    expect(html).toContain('maxLength="100"');
  });
});

describe("profile form (acceptance test 2)", () => {
  it("shows the error and keeps what was typed", async () => {
    const action = vi.fn(async (_previous: ProfileFormState, data: FormData): Promise<ProfileFormState> => ({
      status: "error", error: "name_required", values: { name: String(data.get("name")), facultyId: String(data.get("facultyId")), major: String(data.get("major")) },
    }));
    render(<ProfileForm action={action} email={student.email} faculties={faculties} saved={saved} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Major (optional)"), { target: { value: "Physics" } });
    fireEvent.change(screen.getByLabelText("Faculty (optional)"), { target: { value: "faculty-arts" } });
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Save profile" }).closest("form")!); });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Enter your name.");
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Major (optional)")).toHaveProperty("value", "Physics");
    expect(screen.getByLabelText("Faculty (optional)")).toHaveProperty("value", "faculty-arts");
  });
  it("confirms a save", async () => {
    const action = vi.fn(async (): Promise<ProfileFormState> => ({ status: "saved", values: saved }));
    render(<ProfileForm action={action} email={student.email} faculties={faculties} saved={saved} />);
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Save profile" }).closest("form")!); });
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Profile saved.");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("saveProfileAction", () => {
  it("always saves the session user and ignores an ID in the form (acceptance test 3)", async () => {
    const state = await saveProfileAction({ status: "idle" }, form({ userId: "user-b", id: "user-b", name: "New Name", facultyId: "", major: "" }));
    expect(requireUser).toHaveBeenCalledWith("/profile");
    expect(saveProfile).toHaveBeenCalledWith("user-a", { name: "New Name", facultyId: "", major: "" });
    expect(state).toEqual({ status: "saved", values: { name: "New Name", facultyId: "", major: "" } });
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
  });
  it("returns the typed values with the error", async () => {
    saveProfile.mockResolvedValue({ ok: false, error: "name_required" });
    const state = await saveProfileAction({ status: "idle" }, form({ name: " ", facultyId: "faculty-arts", major: "Physics" }));
    expect(state).toEqual({ status: "error", error: "name_required", values: { name: " ", facultyId: "faculty-arts", major: "Physics" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("profile URLs with an ID (acceptance test 3)", () => {
  const open = (...path: string[]) => ProfileByIdPage({ params: Promise.resolve({ path }) });
  it("denies another student's profile and edit page with the not-found page", async () => {
    await expect(open("user-b")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(open("user-b", "edit")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(logError).toHaveBeenCalledWith("unauthorized_access", { route: "/profile/:id", role: "STUDENT", userId: "user-a" });
    expect(getProfile).not.toHaveBeenCalled();
  });
  it("sends the user's own ID to /profile", async () => {
    await expect(open("user-a")).rejects.toThrow("NEXT_REDIRECT /profile");
    await expect(open("user-a", "edit")).rejects.toThrow("NEXT_REDIRECT /profile");
    await expect(open("user-a", "other")).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("needs a login first", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /login?next=%2Fprofile"));
    await expect(open("user-b")).rejects.toThrow("NEXT_REDIRECT /login");
    expect(logError).not.toHaveBeenCalled();
  });
});
