const header = document.querySelector("header");
const button = document.querySelector(".menu-toggle");
const menu = document.querySelector(".menu-screen");

if (header && button && menu) {
  const setOpen = (open) => {
    button.setAttribute("aria-expanded", String(open));
    header.classList.toggle("is-open", open);
    document.documentElement.classList.toggle("menu-open", open);
    button.querySelector(".menu-label").textContent = open ? "Close" : "Menu";
  };

  button.addEventListener("click", () => {
    setOpen(button.getAttribute("aria-expanded") !== "true");
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
}
