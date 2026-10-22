/** Pure checks for the create-trade wizard. */

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
        id: "terms",
        empty: "Add a terms summary so both sides know the deal.",
      },
      {
        id: "ack",
        empty: "Confirm that TradeSafe does not provide escrow or insurance.",
        check: "checked",
      },
    ],
  },
  {
    fields: [
      {
        id: "display-name",
        empty: "Enter the name you want shown in this trade.",
      },
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

/** @returns {{ id: string, message: string }[]} */
export function problemsForStep(step, values) {
  const spec = CREATE_STEPS[step];
  if (!spec) return [];
  const problems = [];
  for (const field of spec.fields) {
    const message = fieldProblem(field, values[field.id]);
    if (message) problems.push({ id: field.id, message });
  }
  return problems;
}
