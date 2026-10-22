import { describe, expect, it } from "vitest";
import { problemsForStep } from "../../../site/js/create-form.js";

const filled = {
  title: "Camera",
  amount: "120",
  "display-name": "Avery",
  "policy-accept": true,
};

describe("create trade form", () => {
  it("asks for the title, amount, name, and policies", () => {
    const problems = problemsForStep(0, {
      title: "  ",
      amount: "",
      "display-name": "",
      "policy-accept": false,
    });
    expect(problems.map((p) => p.id)).toEqual([
      "title",
      "amount",
      "display-name",
      "policy-accept",
    ]);
  });

  it("rejects a zero amount", () => {
    expect(problemsForStep(0, { ...filled, amount: "0" }).map((p) => p.id)).toEqual([
      "amount",
    ]);
  });

  it("accepts a complete trade", () => {
    expect(problemsForStep(0, filled)).toEqual([]);
  });
});
