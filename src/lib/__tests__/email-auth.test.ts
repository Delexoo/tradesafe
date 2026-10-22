import { describe, expect, it } from "vitest";
import { emailProblem } from "../../../lib/email-auth-check.mjs";

describe("email login", () => {
  it("asks for an email", () => {
    expect(emailProblem("  ")).toMatch(/email/i);
  });

  it("rejects a value that is not an email", () => {
    expect(emailProblem("not-an-email")).toMatch(/valid email/i);
  });

  it("accepts a normal email", () => {
    expect(emailProblem("ada@example.com")).toBeNull();
  });
});
