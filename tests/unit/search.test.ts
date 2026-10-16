import { describe, expect, it } from "vitest";
import { escapeLike } from "@/lib/search";

describe("escapeLike", () => {
  it.each([
    ["%", "\\%"],
    ["_", "\\_"],
    ["\\", "\\\\"],
    ["50%_off\\now", "50\\%\\_off\\\\now"],
    ["%%__", "\\%\\%\\_\\_"],
  ])("escapes %j as %j", (text, expected) => {
    expect(escapeLike(text)).toBe(expected);
  });
  it.each(["", "   ", "CMPS", "eece 350", "Computer Networks"])("leaves %j unchanged", text => {
    expect(escapeLike(text)).toBe(text);
  });
});
