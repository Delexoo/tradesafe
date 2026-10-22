import { describe, expect, it } from "vitest";
import {
  handoffProblem,
  handoffRedirect,
  hashHandoffSecret,
  secretMatches,
  verifiedNextPath,
} from "../../../lib/email-handoff.mjs";

const id = "a".repeat(32);
const secret = "b".repeat(32);

describe("email handoff", () => {
  it("rejects a sign-in that is missing a device secret", () => {
    expect(handoffProblem({ id, secret: "short", email: "ada@example.com" })).toMatch(/not valid/i);
  });

  it("rejects an email that is not usable", () => {
    expect(handoffProblem({ id, secret, email: "not-an-email" })).toMatch(/valid email/i);
  });

  it("accepts a normal handoff and keeps the secret hashed", () => {
    expect(handoffProblem({ id, secret, email: "ada@example.com" })).toBeNull();
    const hash = hashHandoffSecret(secret);
    expect(hash).not.toBe(secret);
    expect(secretMatches(hash, secret)).toBe(true);
    expect(secretMatches(hash, "c".repeat(32))).toBe(false);
  });

  it("sends the email link back to this site only", () => {
    expect(verifiedNextPath("https://evil.example/steal")).toBe("/dashboard.html");
    expect(verifiedNextPath("//evil.example")).toBe("/dashboard.html");
    expect(handoffRedirect("https://tradesafe.example", "/create.html", id)).toBe(
      `https://tradesafe.example/verified.html?login=${id}&next=%2Fcreate.html`,
    );
  });
});
