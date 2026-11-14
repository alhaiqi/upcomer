import { describe, expect, it } from "vitest";
import { adviceMessage, isScopeName, parseResourceLink, topicKeyOf, ADVICE_LINK_MAX_LENGTH } from "@/lib/advice-rules";

describe("parseResourceLink (US-35)", () => {
  it("treats an empty value as no link", () => {
    expect(parseResourceLink("")).toEqual({ ok: true, url: null });
    expect(parseResourceLink("   ")).toEqual({ ok: true, url: null });
  });

  it("accepts a valid https link and normalizes it", () => {
    expect(parseResourceLink("https://example.com/notes?week=3")).toEqual({ ok: true, url: "https://example.com/notes?week=3" });
    expect(parseResourceLink("  HTTPS://Example.com/a  ")).toEqual({ ok: true, url: "https://example.com/a" });
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://example.com"],
    ["ftp://example.com/file"],
    ["file:///etc/passwd"],
    ["//example.com"],
    ["https:example.com"],
    ["example.com"],
    ["https://user:secret@example.com"],
    ["https://localhost"],
    ["https://exa mple.com"],
    ["https://example.com/a\nb"],
    ["https://"],
  ])("refuses %s", value => {
    expect(parseResourceLink(value)).toEqual({ ok: false });
  });

  it("refuses a link that is too long", () => {
    expect(parseResourceLink(`https://example.com/${"a".repeat(ADVICE_LINK_MAX_LENGTH)}`)).toEqual({ ok: false });
  });
});

describe("helpers", () => {
  it("normalizes topics like the learning profile", () => {
    expect(topicKeyOf("  TCP   Basics ")).toBe("tcp basics");
    expect(topicKeyOf("   ")).toBe("");
  });

  it("knows the scope names", () => {
    expect(isScopeName("EXAM")).toBe(true);
    expect(isScopeName("exam")).toBe(false);
    expect(isScopeName("PROFESSOR")).toBe(false);
  });

  it("never echoes an unknown error value", () => {
    expect(adviceMessage("<script>")).toBe(adviceMessage("unexpected"));
    expect(adviceMessage("link_invalid")).toMatch(/https:\/\//);
  });
});
