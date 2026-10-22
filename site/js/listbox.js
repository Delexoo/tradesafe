/** Turn a native <select class="field"> into a styled listbox. Keeps the select in sync. */

export function enhanceSelect(select) {
  if (!select || select.dataset.listbox === "1") return;
  select.dataset.listbox = "1";
  select.classList.add("listbox-native");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");

  const wrap = document.createElement("div");
  wrap.className = "listbox";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "listbox-trigger field";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  if (select.id) button.id = `${select.id}-trigger`;
  wrap.appendChild(button);

  const menu = document.createElement("ul");
  menu.className = "listbox-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  wrap.appendChild(menu);

  const paint = () => {
    const opt = select.options[select.selectedIndex];
    button.textContent = opt?.textContent || "Choose…";
    menu.innerHTML = "";
    for (const option of select.options) {
      const li = document.createElement("li");
      li.className = "listbox-option";
      li.setAttribute("role", "option");
      li.dataset.value = option.value;
      li.textContent = option.textContent;
      li.setAttribute("aria-selected", String(option.selected));
      if (option.selected) li.classList.add("is-selected");
      if (option.disabled) {
        li.setAttribute("aria-disabled", "true");
        li.classList.add("is-disabled");
      }
      menu.appendChild(li);
    }
  };

  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    wrap.classList.remove("is-open");
  };

  const open = () => {
    paint();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    wrap.classList.add("is-open");
  };

  button.addEventListener("click", () => {
    if (select.disabled) return;
    if (menu.hidden) open();
    else close();
  });

  menu.addEventListener("click", (event) => {
    const li = event.target.closest(".listbox-option");
    if (!li || li.classList.contains("is-disabled")) return;
    select.value = li.dataset.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    paint();
    close();
    button.focus();
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) close();
  });

  button.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (menu.hidden) open();
    }
  });

  select.addEventListener("change", paint);
  const syncDisabled = () => {
    button.disabled = select.disabled;
  };
  const observer = new MutationObserver(syncDisabled);
  observer.observe(select, { attributes: true, attributeFilter: ["disabled"] });
  syncDisabled();
  paint();
}

export function enhanceSelects(root = document) {
  root.querySelectorAll("select.field").forEach((el) => enhanceSelect(el));
}
