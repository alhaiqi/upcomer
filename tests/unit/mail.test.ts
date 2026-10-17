import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appOrigin, MailError, sendMail } from "@/lib/mail";

const mail = { to: "lina@mail.aub.edu", subject: "Reset your Upcomer password", text: "Set a new password here: http://localhost:3000/reset-password?token=secret" };
let info: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;
const printed = () => [...info.mock.calls, ...errors.mock.calls].flat().map(String).join("\n");

beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const name of ["MAIL_API_URL", "MAIL_API_KEY", "MAIL_FROM", "APP_URL"]) vi.stubEnv(name, "");
});
afterEach(() => {
  info.mockRestore();
  errors.mockRestore();
  vi.unstubAllEnvs();
});

describe("sendMail without a provider", () => {
  it("prints the message in development only, clearly marked", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await sendMail(mail);
    expect(info).toHaveBeenCalledTimes(1);
    expect(printed()).toContain("==== DEV ONLY: email not sent (no mail provider configured) ====");
    expect(printed()).toContain("token=secret");
    expect(errors).not.toHaveBeenCalled();
  });
  it.each(["production", "test"])("prints nothing in %s and reports that mail is not configured", async environment => {
    vi.stubEnv("NODE_ENV", environment);
    await expect(sendMail(mail)).rejects.toMatchObject({ reason: "not_configured" });
    expect(printed()).toBe("");
  });
});

describe("sendMail with a provider", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MAIL_API_URL", "https://api.resend.com/emails");
    vi.stubEnv("MAIL_API_KEY", "re_test_key");
    vi.stubEnv("MAIL_FROM", "Upcomer <no-reply@upcomer.example.com>");
  });
  it("posts one JSON message with a bearer key and prints nothing", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    await sendMail(mail, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer re_test_key" });
    expect(JSON.parse(String(init.body))).toEqual({ from: "Upcomer <no-reply@upcomer.example.com>", ...mail });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(printed()).toBe("");
  });
  it("reports a refused or unreachable provider without its answer", async () => {
    await expect(sendMail(mail, (async () => new Response("bad key", { status: 401 })) as typeof fetch)).rejects.toEqual(new MailError("provider_rejected", 401));
    await expect(sendMail(mail, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch)).rejects.toMatchObject({ reason: "provider_unreachable" });
    expect(printed()).toBe("");
  });
});

describe("appOrigin", () => {
  it("uses APP_URL without a trailing slash, and localhost only in development", () => {
    vi.stubEnv("APP_URL", "https://upcomer.example.com/");
    expect(appOrigin()).toBe("https://upcomer.example.com");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(appOrigin()).toBe("http://localhost:3000");
    vi.stubEnv("NODE_ENV", "production");
    expect(appOrigin()).toBeNull();
  });
});
