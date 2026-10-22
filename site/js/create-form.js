/** Four short create-trade steps. Description is optional. */

const URL_RE = /^https?:\/\/\S+$/i;

export const CREATE_STEPS = [
  {
    fields: [
      { id: "title", empty: "Enter a trade title." },
      {
        id: "amount",
        empty: "Enter an amount greater than 0.",
        check: "amount",
      },
    ],
  },
  { fields: [] },
  {
    fields: [
      {
        id: "display-name",
        empty: "Enter the name you want shown in this trade.",
      },
    ],
  },
  {
    fields: [
      {
        id: "policy-accept",
        empty: "Accept the required policies to create this trade.",
        check: "checked",
      },
    ],
  },
];

export function fieldProblem(field, value) {
  if (field.check === "checked") return value ? null : field.empty;
  if (field.check === "amount") {
    const raw = String(value ?? "").trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0.01) return field.empty;
    return null;
  }
  if (!String(value ?? "").trim()) return field.empty;
  return null;
}

export function categoryFieldProblems(values) {
  const category = String(values.category || "other");
  const problems = [];
  if (category === "website_domain") {
    if (!String(values.domain_name || "").trim()) {
      problems.push({ id: "domain-name", message: "Enter the domain name." });
    }
  }
  if (category === "digital") {
    const preview = String(values.preview_url || "").trim();
    if (preview && !URL_RE.test(preview)) {
      problems.push({
        id: "preview-url",
        message: "Enter a full preview link starting with http:// or https://.",
      });
    }
  }
  if (category === "service") {
    if (!String(values.service_scope || "").trim()) {
      problems.push({
        id: "service-scope",
        message: "Describe what completion looks like.",
      });
    }
  }
  return problems;
}

/** @returns {{ id: string, message: string }[]} */
export function problemsForStep(step, values) {
  const spec = CREATE_STEPS[step];
  if (!spec) return [];
  const problems = [];
  for (const field of spec.fields) {
    const message = fieldProblem(field, values[field.id]);
    if (message) problems.push({ id: field.id, message });
  }
  if (step === 1) problems.push(...categoryFieldProblems(values));
  return problems;
}

export function deliveryForCategory(category) {
  switch (category) {
    case "physical":
    case "electronics":
    case "collectibles":
      return "shipping";
    case "digital":
    case "website_domain":
      return "digital_transfer";
    case "service":
      return "in_person";
    default:
      return "other";
  }
}
