const links = [
  { href: "/dashboard.html", label: "Dashboard", match: "dashboard" },
  { href: "/history.html", label: "History", match: "history" },
  { href: "/settings.html", label: "Settings", match: "settings" },
];

export function renderAppNav(active) {
  const el = document.getElementById("app-nav");
  if (!el) return;
  el.innerHTML = `
    <a class="brand" href="/dashboard.html">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 5 3.2 8.4 7 9 3.8-.6 7-4 7-9V6l-7-3z"/></svg>
      </span>
      TradeSafe
    </a>
    <nav class="nav-links" aria-label="Main">
      ${links
        .map(
          (l) =>
            `<a href="${l.href}" ${active === l.match ? 'aria-current="page"' : ""}>${l.label}</a>`,
        )
        .join("")}
    </nav>
    <div class="nav-actions">
      <a class="btn btn-sm" href="/create.html">New trade</a>
    </div>
  `;
}
