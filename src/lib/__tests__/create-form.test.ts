import { describe, expect, it } from "vitest";
import {
  categoryFieldProblems,
  deliveryForCategory,
  problemsForStep,
} from "../../../site/js/create-form.js";

const filled = {
  title: "Camera",
  amount: "120",
  "display-name": "Avery",
  "policy-accept": true,
};

describe("create trade wizard", () => {
  it("asks for a title and amount first", () => {
    const problems = problemsForStep(0, { title: "  ", amount: "" });
    expect(problems.map((p) => p.id)).toEqual(["title", "amount"]);
  });

  it("rejects a zero amount", () => {
    expect(problemsForStep(0, { ...filled, amount: "0" }).map((p) => p.id)).toEqual([
      "amount",
    ]);
  });

  it("lets the description stay blank", () => {
    expect(problemsForStep(1, { description: "", category: "other" })).toEqual([]);
  });

  it("requires a domain for website trades", () => {
    expect(
      categoryFieldProblems({ category: "website_domain", domain_name: "" }).map((p) => p.id),
    ).toEqual(["domain-name"]);
  });

  it("rejects a bad digital preview url", () => {
    expect(
      categoryFieldProblems({
        category: "digital",
        preview_url: "not-a-url",
      }).map((p) => p.id),
    ).toEqual(["preview-url"]);
  });

  it("requires completion criteria for services", () => {
    expect(
      categoryFieldProblems({ category: "service", service_scope: "  " }).map((p) => p.id),
    ).toEqual(["service-scope"]);
  });

  it("suggests delivery from category", () => {
    expect(deliveryForCategory("physical")).toBe("shipping");
    expect(deliveryForCategory("digital")).toBe("digital_transfer");
    expect(deliveryForCategory("website_domain")).toBe("digital_transfer");
    expect(deliveryForCategory("service")).toBe("in_person");
  });

  it("asks for a display name on the role step", () => {
    expect(problemsForStep(2, { "display-name": "" }).map((p) => p.id)).toEqual([
      "display-name",
    ]);
    expect(problemsForStep(2, filled)).toEqual([]);
  });

  it("asks for the policies on the last step", () => {
    expect(problemsForStep(3, { "policy-accept": false }).map((p) => p.id)).toEqual([
      "policy-accept",
    ]);
    expect(problemsForStep(3, filled)).toEqual([]);
  });
});
