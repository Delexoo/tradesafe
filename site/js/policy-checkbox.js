/** Shared policy acceptance checkbox (unchecked by default). */

export function policyCheckboxHtml(id = "policy-accept") {
  return `
<label class="policy-accept" for="${id}">
  <input type="checkbox" id="${id}" name="policy_accept" required>
  <span>
    I have read and agree to the
    <a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a>,
    <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>,
    and
    <a href="/transaction-policies.html" target="_blank" rel="noopener">Transaction and Dispute Policies</a>.
    <em class="policy-required">Required to continue.</em>
  </span>
</label>`;
}

export function wirePolicyGate(checkbox, actionButton, errorEl) {
  const sync = () => {
    const ok = checkbox.checked;
    if (actionButton) actionButton.disabled = !ok;
    if (!ok && errorEl && errorEl.dataset.clearOnUncheck !== "false") {
      // keep prior errors unless empty
    }
  };
  checkbox.checked = false;
  checkbox.addEventListener("change", sync);
  sync();
  return {
    assertAccepted() {
      if (!checkbox.checked) {
        const msg =
          "Please accept the Terms of Service, Privacy Policy, and Transaction and Dispute Policies.";
        if (errorEl) {
          errorEl.textContent = msg;
          errorEl.classList.remove("hidden");
        }
        checkbox.focus();
        throw new Error(msg);
      }
      return true;
    },
  };
}
