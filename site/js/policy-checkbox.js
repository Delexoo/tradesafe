/** Shared policy acceptance — required unchecked + separate optional device. */

export function policyCheckboxHtml(ids = {}) {
  const requiredId = ids.required || "policy-accept";
  const optionalId = ids.optional || "device-optional";
  if (ids.wizard) {
    return `
<div class="policy-block policy-wizard">
  <p class="hint policy-explain">TradeSafe does not hold the money.</p>
  <label class="policy-accept" for="${requiredId}">
    <input type="checkbox" id="${requiredId}" name="policy_accept">
    <span>
      I agree to the
      <a href="/legal.html#terms" target="_blank" rel="noopener">Terms</a>,
      <a href="/legal.html#privacy" target="_blank" rel="noopener">Privacy</a>,
      <a href="/legal.html#disputes" target="_blank" rel="noopener">Dispute</a>,
      <a href="/legal.html#security" target="_blank" rel="noopener">Security</a>,
      and
      <a href="/legal.html#device" target="_blank" rel="noopener">Device</a>
      policies.
    </span>
  </label>
  <label class="policy-accept policy-optional" for="${optionalId}">
    <input type="checkbox" id="${optionalId}" name="device_optional">
    <span>Optional: remember this browser to spot suspicious logins.</span>
  </label>
</div>`;
  }
  const explain = ids.compact
    ? `<p class="hint policy-explain">Accept the policies to create this trade. TradeSafe does not hold the money.</p>`
    : `<p class="hint policy-explain">
    TradeSafe collects security information to protect trades against fraud, unauthorized access, and abuse.
    <strong>Required</strong> signals include a hashed network reference (not sold), session identifiers, and security-event logs reviewed by authorized staff when investigating reports or incidents.
    Data is retained only as long as needed for security and legal obligations (typically up to 24 months unless a legal hold applies). Processors such as hosting and database providers may process data as disclosed in the Privacy Policy. We do not sell your data.
  </p>`;
  return `
<div class="policy-block">
  ${explain}
  <label class="policy-accept" for="${requiredId}">
    <input type="checkbox" id="${requiredId}" name="policy_accept">
    <span>
      I have read and agree to the
      <a href="/legal.html#terms" target="_blank" rel="noopener">Terms of Service</a>,
      <a href="/legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a>,
      <a href="/legal.html#disputes" target="_blank" rel="noopener">Transaction and Dispute Policy</a>,
      <a href="/legal.html#security" target="_blank" rel="noopener">Security and Fraud Prevention Policy</a>,
      and
      <a href="/legal.html#device" target="_blank" rel="noopener">Device Recognition and Security Logging Notice</a>.
      <em class="policy-required">Required — unchecked by default. Create and join are blocked until accepted on the server.</em>
    </span>
  </label>
  <label class="policy-accept policy-optional" for="${optionalId}">
    <input type="checkbox" id="${optionalId}" name="device_optional">
    <span>
      Optional: allow a first-party device recognition cookie (random token + coarse browser/OS category) to help detect suspicious session changes.
      Declining does not block create/join; essential security controls still apply. This is <strong>not</strong> proof of identity and is not invasive fingerprinting.
    </span>
  </label>
</div>`;
}

export function wirePolicyGate(requiredCheckbox, actionButton, errorEl, optionalCheckbox) {
  const sync = () => {
    const ok = requiredCheckbox.checked;
    if (actionButton) actionButton.disabled = !ok;
  };
  requiredCheckbox.checked = false;
  if (optionalCheckbox) optionalCheckbox.checked = false;
  requiredCheckbox.addEventListener("change", sync);
  sync();
  return {
    assertAccepted() {
      if (!requiredCheckbox.checked) {
        const msg =
          "Please accept the required Terms, Privacy, Dispute, Security, and Device Notice policies.";
        if (errorEl) {
          errorEl.textContent = msg;
          errorEl.classList.remove("hidden");
        }
        requiredCheckbox.focus();
        throw new Error(msg);
      }
      return true;
    },
    optionalDeviceAccepted() {
      return !!(optionalCheckbox && optionalCheckbox.checked);
    },
  };
}
