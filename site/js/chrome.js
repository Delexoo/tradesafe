/** Shared Hooxie-style header + footer for TradeSafe pages. */
import { authPanelHtml, bindEmailAuth } from "./email-auth.js";
import { getSession } from "./supabase.js";

const MENU_LINKS = [
  { href: "/create.html", label: "Create a trade" },
  { href: "/dashboard.html", label: "My trades" },
  { href: "/#how", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
  { href: "/legal.html", label: "Legal" },
];

const HOME_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.5v-6h-3v6H5a1 1 0 0 1-1-1z"/></svg>`;

export function mountChrome({ active } = {}) {
  const header = document.getElementById("site-header");
  if (header) {
    const params = new URLSearchParams(location.search);
    const startMode = params.get("mode") === "signup" ? "signup" : "login";
    header.innerHTML = `
      <div class="nav-pair" role="group" aria-label="Home and menu">
        <a class="home-btn" href="/" aria-label="Home">${HOME_ICON}</a>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu">
          <span class="menu-label">Menu</span>
          <span class="menu-bars" aria-hidden="true"></span>
        </button>
      </div>
      <button class="login-toggle" type="button" aria-expanded="false" aria-controls="auth-panel">Log in</button>
      <nav class="menu-screen" id="site-menu" aria-label="Pages">
        ${MENU_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}
      </nav>
      <div class="auth-screen" id="auth-panel" hidden>
        ${authPanelHtml(startMode)}
      </div>
    `;

    const loginBtn = header.querySelector(".login-toggle");
    const auth = header.querySelector(".auth-screen");
    const menuBtn = header.querySelector(".menu-toggle");
    const authApi = bindEmailAuth(auth, { initialMode: startMode });

    const setAuthOpen = (open) => {
      auth.hidden = !open;
      loginBtn.setAttribute("aria-expanded", String(open));
      document.documentElement.classList.toggle("auth-open", open);
      if (open) {
        if (menuBtn.getAttribute("aria-expanded") === "true") menuBtn.click();
        authApi?.focus();
      }
    };

    loginBtn.addEventListener("click", () => {
      setAuthOpen(loginBtn.getAttribute("aria-expanded") !== "true");
    });
    auth.addEventListener("click", (event) => {
      if (event.target === auth) setAuthOpen(false);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setAuthOpen(false);
    });

    getSession()
      .then((session) => {
        if (session?.user?.email) loginBtn.textContent = "Account";
      })
      .catch(() => {});

    import("./supabase.js").then(({ getSupabase }) =>
      getSupabase().then((sb) => {
        sb.auth.onAuthStateChange((_event, session) => {
          loginBtn.textContent = session?.user?.email ? "Account" : "Log in";
        });
      }),
    );
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.innerHTML = `
      <nav class="footer-product" aria-label="Product">
        <p>Product</p>
        <div class="footer-links">
          <a href="/create.html">Create a trade</a>
          <a href="/dashboard.html">My trades</a>
          <a href="/#how">How it works</a>
          <a href="/#faq">FAQ</a>
          <a href="/legal.html">Legal</a>
          <a href="/legal.html#privacy">Privacy</a>
        </div>
      </nav>
      <p style="margin:1.5rem 0 0">TradeSafe · © <span data-year></span></p>
    `;
    footer.querySelectorAll("[data-year]").forEach((el) => {
      el.textContent = String(new Date().getFullYear());
    });
  }

  import("/menu.js");
}
