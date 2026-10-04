import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { saveLogEntry, getOriginalFile } = vi.hoisted(() => ({ saveLogEntry: vi.fn(), getOriginalFile: vi.fn() }));
vi.mock("@/lib/log-store", () => ({ saveLogEntry }));
vi.mock("@/lib/files", () => ({ getOriginalFile, FileUnavailableError: class FileUnavailableError extends Error {} }));
import { configureLogger, defaultStoreLoader, errorCode, EVENT_LEVELS, levelOf, logError, MAX_VALUE_LENGTH, sanitizeContext, type LogEvent } from "@/lib/logger";
import { GET } from "@/app/files/[fileId]/route";

let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const mockStore = () => Promise.resolve({ saveLogEntry });

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  saveLogEntry.mockReset().mockResolvedValue(undefined);
  getOriginalFile.mockReset();
});
afterEach(() => {
  errors.mockRestore();
  warnings.mockRestore();
  vi.unstubAllEnvs();
  configureLogger({ persist: false, store: defaultStoreLoader });
});

describe("severity levels", () => {
  it("gives every event a level from one table", () => {
    for (const level of Object.values(EVENT_LEVELS)) expect(["error", "warn", "info"]).toContain(level);
    expect(EVENT_LEVELS.physical_file_not_found).toBe("error");
    expect(EVENT_LEVELS.file_open_failed).toBe("error");
    expect(EVENT_LEVELS.upload_storage_failed).toBe("error");
    expect(EVENT_LEVELS.catalog_entry_save_failed).toBe("error");
    for (const event of ["login_failed", "signup_failed", "unauthorized_access", "upload_rejected", "catalog_entry_rejected", "file_metadata_rejected"] as LogEvent[]) {
      expect(EVENT_LEVELS[event]).toBe("warn");
    }
    expect(EVENT_LEVELS.monitoring_alert_triggered).toBe("info");
  });
  it("raises a refusal caused by a database failure to error", () => {
    expect(levelOf("login_failed", { reason: "invalid_credentials" })).toBe("warn");
    expect(levelOf("login_failed", { reason: "db_error" })).toBe("error");
    expect(levelOf("session_validation_failed", { reason: "db_error" })).toBe("error");
    expect(levelOf("file_open_failed", { reason: "db_error" })).toBe("error");
  });
});

describe("console output", () => {
  it("keeps today's JSON line and adds the level", () => {
    logError("course_retrieval_failed", { courseId: "course-a", errorType: "Error" });
    expect(errors).toHaveBeenCalledTimes(1);
    const [line] = logged();
    expect(line).toEqual({ event: "course_retrieval_failed", level: "error", timestamp: expect.any(String), courseId: "course-a", errorType: "Error" });
    expect(Object.keys(line)[0]).toBe("event");
  });
  it("logs a warn event at warn level", () => {
    logError("upload_rejected", { reason: "empty_file" });
    expect(logged()[0]).toMatchObject({ event: "upload_rejected", level: "warn", reason: "empty_file" });
  });
});

describe("sanitizing", () => {
  it(`caps every value at ${MAX_VALUE_LENGTH} characters`, () => {
    logError("file_record_not_found", { fileId: "x".repeat(5000) });
    const { fileId } = logged()[0];
    expect(fileId).toHaveLength(MAX_VALUE_LENGTH + 1);
    expect(fileId.endsWith("…")).toBe(true);
    expect(JSON.stringify(logged()[0]).length).toBeLessThan(400);
  });
  it("strips control characters, so a value cannot fake a new log line", () => {
    const clean = sanitizeContext({ fileId: "abc\n{\"event\":\"forged\"}\r\u0000\u001b[31m\u007f" });
    expect(clean.fileId).toBe('abc{"event":"forged"}[31m');
  });
  it("drops sensitive keys but keeps IDs and reasons", () => {
    const clean = sanitizeContext({
      password: "hunter2", newPassword: "x", token: "t", sessionToken: "t", tokenHash: "h", apiKey: "k", api_key: "k",
      secret: "s", cookie: "c", email: "a@b.c", userEmail: "a@b.c", authorization: "Bearer x",
      sessionId: "session-1", userId: "user-1", reason: "expired", route: "/admin",
    });
    expect(clean).toEqual({ sessionId: "session-1", userId: "user-1", reason: "expired", route: "/admin" });
  });
  it("drops undefined values and never lets context overwrite the line's own fields", () => {
    logError("upload_failed", { courseId: undefined, event: "forged", level: "info", timestamp: "then" });
    expect(logged()[0]).toEqual({ event: "upload_failed", level: "error", timestamp: expect.not.stringMatching(/^then$/) });
  });
});

describe("error codes", () => {
  it("returns short Node and Prisma codes only", () => {
    expect(errorCode(Object.assign(new Error("no such file"), { code: "ENOENT" }))).toBe("ENOENT");
    expect(errorCode({ code: "P2002" })).toBe("P2002");
    expect(errorCode(new Error("plain"))).toBeUndefined();
    expect(errorCode({ code: 42 })).toBeUndefined();
    expect(errorCode({ code: "not a code with spaces" })).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
  it("is logged when a file cannot be opened, without the error message or path", async () => {
    getOriginalFile.mockRejectedValue(Object.assign(new Error("EISDIR: illegal operation on a directory, read 'C:\\private\\exams'"), { code: "EISDIR" }));
    const response = await GET(new Request("http://localhost/files/file-a"), { params: Promise.resolve({ fileId: "file-a" }) });
    expect(response.status).toBe(500);
    expect(logged()).toEqual([expect.objectContaining({ event: "file_open_failed", level: "error", fileId: "file-a", errorType: "Error", errorCode: "EISDIR" })]);
    expect(JSON.stringify(logged())).not.toContain("private");
  });
});

describe("persistence", () => {
  it("is off under tests by default, so unit tests never write to the database", async () => {
    logError("upload_failed", { errorType: "Error" });
    await settle();
    expect(saveLogEntry).not.toHaveBeenCalled();
  });
  it("never loads the real store under tests, even with persistence switched on", async () => {
    configureLogger({ persist: true, store: defaultStoreLoader });
    logError("upload_failed", {});
    await vi.waitFor(() => expect(warnings).toHaveBeenCalledTimes(1));
    expect(saveLogEntry).not.toHaveBeenCalled();
    await expect(defaultStoreLoader()).rejects.toThrow("not loaded in tests");
  });
  it("saves the sanitized line through the store when enabled", async () => {
    configureLogger({ persist: true, store: mockStore });
    logError("physical_file_not_found", { fileId: "file-missing", password: "x" });
    await vi.waitFor(() => expect(saveLogEntry).toHaveBeenCalled());
    expect(saveLogEntry).toHaveBeenCalledWith({ event: "physical_file_not_found", level: "error", timestamp: expect.any(String), fileId: "file-missing" });
  });
  it("is skipped on the edge runtime", async () => {
    configureLogger({ persist: true, store: mockStore });
    vi.stubEnv("NEXT_RUNTIME", "edge");
    logError("upload_failed", {});
    await settle();
    expect(saveLogEntry).not.toHaveBeenCalled();
  });
  it("falls back to the console with one warning when the database fails, without recursing or throwing", async () => {
    saveLogEntry.mockRejectedValue(new Error("database down"));
    configureLogger({ persist: true, store: mockStore });
    expect(logError("upload_failed", { errorType: "Error" })).toBeUndefined();
    logError("course_search_failed", { errorType: "Error" });
    logError("logout_failed", { errorType: "Error" });
    await vi.waitFor(() => expect(saveLogEntry).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(warnings).toHaveBeenCalled());
    await settle();
    expect(errors).toHaveBeenCalledTimes(3);
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warnings.mock.calls[0][0]))).toMatchObject({ event: "log_persistence_unavailable" });
    expect(String(warnings.mock.calls[0][0])).not.toContain("database down");
  });
  it("survives a store that cannot even be loaded", async () => {
    configureLogger({ persist: true, store: () => Promise.reject(new Error("module missing")) });
    expect(() => logError("upload_failed", {})).not.toThrow();
    configureLogger({ persist: true, store: () => { throw new Error("sync failure"); } });
    expect(() => logError("upload_failed", {})).not.toThrow();
    await settle();
    expect(errors).toHaveBeenCalledTimes(2);
  });
  it("does not make the caller wait for the database", () => {
    saveLogEntry.mockReturnValue(new Promise(() => {}));
    configureLogger({ persist: true, store: mockStore });
    const started = performance.now();
    logError("upload_failed", {});
    expect(performance.now() - started).toBeLessThan(50);
  });
});
