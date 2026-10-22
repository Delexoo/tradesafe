/** Shared Hooxie-style header + footer for TradeSafe pages. */
const MENU_LINKS = [
  { href: "/", label: "Home" },
  { href: "/create.html", label: "Create a trade" },
  { href: "/dashboard.html", label: "My trades" },
  { href: "/#how", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
  { href: "/legal.html", label: "Legal" },
];

export function mountChrome({ active } = {}) {
  const header = document.getElementById("site-header");
  if (header) {
    header.innerHTML = `
      <a class="home-btn" href="/" aria-label="Home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-5v-6.2H10V21H5a1 1 0 0 1-1-1z"/></svg></a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu">
        <span class="menu-label">Menu</span>
        <span class="menu-bars" aria-hidden="true"></span>
      </button>
      <nav class="menu-screen" id="site-menu" aria-label="Pages">
        ${MENU_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}
      </nav>
    `;
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
