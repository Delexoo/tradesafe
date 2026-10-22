import { requireUser, api, getSession } from "./supabase.js";
import { renderAppNav } from "./nav.js";

renderAppNav("dashboard");

const params = new URLSearchParams(location.search);
const token = params.get("token") || location.pathname.split("/").pop();
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const joinBtn = document.getElementById("join-btn");

async function runJoin() {
  statusEl.textContent = "Joining…";
  try {
    const result = await api("/api/invitations/join", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    location.href = `/room.html?id=${result.transactionId}`;
  } catch (err) {
    statusEl.classList.add("hidden");
    errorEl.textContent = err.message || "Could not join";
    errorEl.classList.remove("hidden");
  }
}

try {
  const session = await getSession();
  if (!session) {
    statusEl.textContent = "Sign in to accept this invitation.";
    joinBtn.textContent = "Sign in to join";
    joinBtn.classList.remove("hidden");
    joinBtn.onclick = () => {
      location.href = `/login.html?next=${encodeURIComponent(`/join.html?token=${token}`)}`;
    };
  } else {
    await requireUser();
    joinBtn.classList.remove("hidden");
    joinBtn.onclick = runJoin;
    statusEl.textContent = "Invitation ready.";
    // Auto-join when already signed in
    await runJoin();
  }
} catch (err) {
  statusEl.classList.add("hidden");
  errorEl.textContent = err.message || "Invalid invitation";
  errorEl.classList.remove("hidden");
}
