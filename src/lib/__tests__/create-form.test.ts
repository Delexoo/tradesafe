import { describe, expect, it } from "vitest";
import { problemsForStep } from "../../../site/js/create-form.js";

const filled = {
  title: "Camera",
  description: "A film camera",
  amount: "120",
  terms: "Ship within 5 days",
  ack: true,
  "display-name": "Avery",
  "policy-accept": true,
};

describe("create trade step validation", () => {
  it("asks for a title and amount, and allows a blank description", () => {
    const problems = problemsForStep(0, { title: "  ", description: "", amount: "" });
    expect(problems.map((p) => p.id)).toEqual(["title", "amount"]);
    expect(problems[0].message).toMatch(/title/i);
  });

  it("rejects a zero amount", () => {
    const problems = problemsForStep(0, { ...filled, amount: "0" });
    expect(problems.map((p) => p.id)).toEqual(["amount"]);
  });

  it("accepts complete details and role", () => {
    expect(problemsForStep(0, filled)).toEqual([]);
    expect(problemsForStep(1, filled)).toEqual([]);
  });

  it("requires terms and the escrow acknowledgement", () => {
    const problems = problemsForStep(2, { terms: "", ack: false });
    expect(problems.map((p) => p.id)).toEqual(["terms", "ack"]);
  });

  it("requires a display name and policy acceptance", () => {
    const problems = problemsForStep(3, { "display-name": "", "policy-accept": false });
    expect(problems.map((p) => p.id)).toEqual(["display-name", "policy-accept"]);
  });
});
