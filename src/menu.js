// The menu bar: File, Edit, View, Image and Help.
//
// It follows the WAI-ARIA menubar pattern and the Windows habits that go with it:
// Alt or F10 moves to the bar, Alt and a letter opens a menu, the arrow keys move,
// Enter runs an item and Escape backs out one level. Once a menu is open, pointing
// at another menu switches to it. Shortcuts sit at the right of each item, and
// items that cannot be used right now are greyed but still reachable.
//
// A menu is described as plain data, so the page decides what the items do:
//   { id, label, mnemonic, items: [item, ...] }
// where an item is one of
//   { type: "item", label, run, shortcut?, enabled?, hidden? }
//   { type: "check" | "radio", label, run, checked, shortcut?, enabled?, hidden? }
//   { type: "sub", label, items: [item, ...], enabled?, hidden? }
//   { type: "heading", label }   { type: "separator" }
// `enabled`, `hidden` and `checked` are functions, asked each time a menu opens.
// Below the phone breakpoint the bar folds into one "Menu" button whose menu
// holds the five menus as submenus.

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// "Ctrl+Shift+Z" as aria-keyshortcuts says it.
const ariaKeys = (shortcut) =>
  shortcut
    .replace(/Ctrl/g, "Control")
    .replace(/\bEsc\b/g, "Escape")
    .replace(/\s+/g, "")
    .replace(/−/g, "-");

export function createMenubar({ root, menus, label = "Application menu" }) {
  root.setAttribute("role", "menubar");
  root.setAttribute("aria-label", label);
  let open = [], // the popups now showing: the menu, then any submenus
    opener = null, // the bar button the first popup hangs from
    returnTo = null, // where focus goes when everything closes
    altAlone = false;

  const tops = menus.map((menu) => {
      const button = make("button", "menu-top");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.tabIndex = -1;
      // The mnemonic is underlined while the bar is in use from the keyboard.
      const at = menu.label.toLowerCase().indexOf(menu.mnemonic);
      if (at < 0) button.textContent = menu.label;
      else
        button.append(
          menu.label.slice(0, at),
          make("u", "mnemonic", menu.label[at]),
          menu.label.slice(at + 1),
        );
      button.setAttribute("aria-label", menu.label);
      button.setAttribute(
        "aria-keyshortcuts",
        "Alt+" + menu.mnemonic.toUpperCase(),
      );
      root.append(button);
      return { menu, button };
    }),
    fold = make("button", "menu-fold", "Menu");
  fold.type = "button";
  fold.setAttribute("role", "menuitem");
  fold.setAttribute("aria-haspopup", "menu");
  fold.setAttribute("aria-expanded", "false");
  fold.tabIndex = -1;
  root.append(fold);
  // Narrow windows show only the fold button (see .menubar in the stylesheet).
  const visibleTops = () =>
    getComputedStyle(fold).display !== "none"
      ? [fold]
      : tops.map((t) => t.button);

  function setStop(button) {
    for (const b of [...tops.map((t) => t.button), fold])
      b.tabIndex = b === button ? 0 : -1;
  }
  setStop(tops[0].button);

  // On a phone there is no room beside a menu for its submenu, so the submenu
  // takes the menu's place, with a Back row to return.
  const narrow = () => innerWidth < 600;
  const live = (items) => items.filter((i) => !i.hidden?.());
  function itemsOf(popup) {
    return [...popup.querySelectorAll('[role^="menuitem"]')];
  }
  function focusItem(popup, which) {
    const items = itemsOf(popup);
    if (!items.length) return;
    const at =
      which === "first"
        ? 0
        : which === "last"
          ? items.length - 1
          : clampIndex(items.indexOf(document.activeElement) + which, items);
    items[at].focus();
  }
  const clampIndex = (i, items) => (i + items.length) % items.length;

  // Builds one popup, its items fresh from the data (so labels and states are current).
  // `back`, for a submenu that replaces its parent, adds a row that returns to it.
  function build(items, name, back) {
    const popup = make("div", "menu-pop");
    popup.setAttribute("role", "menu");
    popup.setAttribute("aria-label", name);
    popup.tabIndex = -1;
    if (back) {
      const row = make("button", "menu-item menu-back");
      row.type = "button";
      row.tabIndex = -1;
      row.setAttribute("role", "menuitem");
      const mark = make("span", "menu-mark", "‹");
      mark.setAttribute("aria-hidden", "true");
      row.append(
        mark,
        make(
          "span",
          "menu-label",
          "Back to " + root.getAttribute("aria-label"),
        ),
      );
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        back();
      });
      popup.append(row);
    }
    for (const item of live(items)) {
      if (item.type === "separator") {
        const hr = make("div", "menu-sep");
        hr.setAttribute("role", "separator");
        popup.append(hr);
        continue;
      }
      if (item.type === "heading") {
        const head = make("div", "menu-heading", item.label);
        head.setAttribute("role", "presentation");
        popup.append(head);
        continue;
      }
      const row = make("button", "menu-item");
      row.type = "button";
      row.tabIndex = -1;
      const kind = item.type,
        mark = make("span", "menu-mark"),
        text = make("span", "menu-label", item.label);
      mark.setAttribute("aria-hidden", "true");
      row.append(mark, text);
      row.setAttribute(
        "role",
        kind === "check"
          ? "menuitemcheckbox"
          : kind === "radio"
            ? "menuitemradio"
            : "menuitem",
      );
      if (kind === "check" || kind === "radio")
        row.setAttribute("aria-checked", String(!!item.checked?.()));
      if (item.shortcut) {
        row.append(make("span", "menu-shortcut", item.shortcut));
        row.setAttribute("aria-keyshortcuts", ariaKeys(item.shortcut));
      }
      if (kind === "sub") {
        const arrow = make("span", "menu-arrow", "▸");
        arrow.setAttribute("aria-hidden", "true");
        row.append(arrow);
        row.setAttribute("aria-haspopup", "menu");
        row.setAttribute("aria-expanded", "false");
      }
      const disabled = item.enabled ? !item.enabled() : false;
      if (disabled) row.setAttribute("aria-disabled", "true");
      const unavailable = () => row.getAttribute("aria-disabled") === "true";
      row.addEventListener("pointerenter", () => {
        row.focus({ preventScroll: true });
        const depth = open.indexOf(popup);
        if (depth < 0) return;
        // Pointing at another item closes a submenu opened from a sibling.
        if (open[depth + 1] && open[depth + 1]._from !== row)
          closeFrom(depth + 1);
        // Where a submenu replaces its parent it opens on a click, not by pointing.
        if (kind === "sub" && !unavailable() && !narrow())
          openSub(popup, row, item, false);
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (unavailable()) return;
        if (kind === "sub") openSub(popup, row, item, false);
        else activate(item);
      });
      popup.append(row);
    }
    popup.addEventListener("keydown", (e) => keyInPopup(e, popup));
    return popup;
  }

  function place(popup, anchor, asSub, parent) {
    document.body.append(popup);
    const a = anchor.getBoundingClientRect(),
      w = popup.offsetWidth,
      h = popup.offsetHeight,
      room = innerHeight - 8;
    let left = asSub ? a.right - 2 : a.left,
      top = asSub ? a.top - 5 : a.bottom + 2;
    if (left + w > innerWidth - 4)
      left = asSub ? a.left - w + 2 : innerWidth - w - 4;
    if (asSub && narrow() && parent) {
      // In the place of its parent, as wide as it.
      const p = parent.getBoundingClientRect();
      left = p.left;
      top = p.top;
      popup.style.minWidth = p.width + "px";
    }
    popup.style.maxHeight = room - 8 + "px";
    if (top + Math.min(h, room) > innerHeight - 4)
      top = Math.max(4, innerHeight - 4 - Math.min(h, room));
    popup.style.left = Math.max(4, left) + "px";
    popup.style.top = top + "px";
  }

  function closeFrom(depth) {
    while (open.length > depth) {
      const popup = open.pop();
      popup.remove();
      const parent = open[open.length - 1];
      const from = popup._from;
      if (from) from.setAttribute("aria-expanded", "false");
      if (!parent && opener) opener.setAttribute("aria-expanded", "false");
    }
  }
  function closeAll(restore) {
    closeFrom(0);
    if (opener) opener.setAttribute("aria-expanded", "false");
    opener = null;
    root.classList.remove("show-keys");
    if (restore && returnTo?.isConnected)
      returnTo.focus({ preventScroll: true });
    returnTo = null;
  }

  function openMenu(button, items, name, via) {
    if (opener === button && open.length) return;
    const wasOpen = open.length > 0;
    closeFrom(0);
    if (opener) opener.setAttribute("aria-expanded", "false");
    if (!wasOpen && !root.contains(document.activeElement))
      returnTo = document.activeElement;
    opener = button;
    setStop(button);
    button.setAttribute("aria-expanded", "true");
    const popup = build(items, name);
    popup._from = null;
    open.push(popup);
    place(popup, button, false);
    if (via === "keyboard") {
      root.classList.add("show-keys");
      focusItem(popup, "first");
    } else popup.focus({ preventScroll: true });
    return popup;
  }
  function openSub(parent, row, item, keyboard) {
    const depth = open.indexOf(parent);
    if (depth >= 0 && open[depth + 1]?._from === row) {
      if (keyboard) focusItem(open[depth + 1], "first");
      return;
    }
    closeFrom(depth + 1);
    row.setAttribute("aria-expanded", "true");
    const popup = build(
      item.items,
      item.label,
      narrow()
        ? () => {
            closeFrom(depth + 1);
            row.focus();
          }
        : null,
    );
    popup._from = row;
    open.push(popup);
    place(popup, row, true, parent);
    // Over its parent, a submenu starts on its first real item, not on Back.
    const rows = itemsOf(popup);
    if (keyboard || narrow()) (rows[narrow() ? 1 : 0] || rows[0])?.focus();
  }
  function activate(item) {
    if (item.enabled && !item.enabled()) return;
    closeAll(true);
    item.run?.();
  }

  // The bar's own keys.
  function barKey(e, button) {
    const list = visibleTops(),
      at = list.indexOf(button),
      move = (step) => {
        const next = list[(at + step + list.length) % list.length];
        setStop(next);
        next.focus();
        if (open.length) openFor(next, "keyboard");
      };
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        return move(1);
      case "ArrowLeft":
        e.preventDefault();
        return move(-1);
      case "ArrowDown":
      case "Enter":
      case " ":
        e.preventDefault();
        return openFor(button, "keyboard");
      case "ArrowUp":
        e.preventDefault();
        openFor(button, "keyboard");
        return focusItem(open[0], "last");
      case "Home":
        e.preventDefault();
        list[0].focus();
        return setStop(list[0]);
      case "End":
        e.preventDefault();
        list[list.length - 1].focus();
        return setStop(list[list.length - 1]);
      case "Escape":
        e.preventDefault();
        if (open.length) closeAll(false);
        else {
          root.classList.remove("show-keys");
          if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
          returnTo = null;
        }
    }
  }
  function openFor(button, via) {
    if (button === fold)
      return openMenu(
        fold,
        menus.map((m) => ({ type: "sub", label: m.label, items: m.items })),
        label,
        via,
      );
    const top = tops.find((t) => t.button === button);
    return openMenu(button, top.menu.items, top.menu.label, via);
  }

  // Keys inside a popup.
  function keyInPopup(e, popup) {
    const depth = open.indexOf(popup),
      focused = document.activeElement,
      item = itemsOf(popup).includes(focused) ? focused : null;
    // While a menu is open its keys are its own: the page's shortcuts stay quiet.
    e.stopPropagation();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return focusItem(popup, item ? 1 : "first");
      case "ArrowUp":
        e.preventDefault();
        return focusItem(popup, item ? -1 : "last");
      case "Home":
        e.preventDefault();
        return focusItem(popup, "first");
      case "End":
        e.preventDefault();
        return focusItem(popup, "last");
      case "ArrowRight":
        e.preventDefault();
        if (item?.getAttribute("aria-haspopup") === "menu") {
          item.click();
          if (open[depth + 1]) focusItem(open[depth + 1], "first");
        } else if (depth === 0 && opener !== fold) {
          const list = visibleTops(),
            next = list[(list.indexOf(opener) + 1) % list.length];
          setStop(next);
          openFor(next, "keyboard");
        }
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (depth > 0) {
          const from = popup._from;
          closeFrom(depth);
          from?.focus();
        } else if (opener !== fold) {
          const list = visibleTops(),
            next = list[(list.indexOf(opener) - 1 + list.length) % list.length];
          setStop(next);
          openFor(next, "keyboard");
        }
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (item) item.click();
        return;
      case "Escape": {
        e.preventDefault();
        e.stopPropagation();
        if (depth > 0) {
          const from = popup._from;
          closeFrom(depth);
          from?.focus();
        } else {
          const back = opener;
          closeFrom(0);
          back?.setAttribute("aria-expanded", "false");
          back?.focus();
        }
        return;
      }
      case "Tab":
        closeAll(false);
        return;
    }
    // Typing a letter jumps to the next item that starts with it.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const items = itemsOf(popup),
        letter = e.key.toLowerCase(),
        start = items.indexOf(item) + 1;
      for (let i = 0; i < items.length; i++) {
        const next = items[(start + i) % items.length];
        if (next.textContent.trim().toLowerCase().startsWith(letter)) {
          next.focus();
          break;
        }
      }
    }
  }

  for (const { button } of tops) {
    button.addEventListener("click", () => {
      if (opener === button && open.length) closeAll(true);
      else openFor(button, "pointer");
    });
    // Once a menu is open, pointing at another one switches to it.
    button.addEventListener("pointerenter", () => {
      if (open.length && opener !== button) openFor(button, "pointer");
    });
    button.addEventListener("keydown", (e) => barKey(e, button));
  }
  fold.addEventListener("click", () => {
    if (opener === fold && open.length) closeAll(true);
    else openFor(fold, "pointer");
  });
  fold.addEventListener("keydown", (e) => barKey(e, fold));

  // Clicking or pressing anywhere else closes the menus.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const inside =
        root.contains(e.target) || open.some((p) => p.contains(e.target));
      if (!open.length) {
        root.classList.remove("show-keys");
        // Remember what had focus, so a mouse-opened menu gives it back.
        if (inside && !root.contains(document.activeElement))
          returnTo = document.activeElement;
        return;
      }
      if (!inside) closeAll(false);
    },
    true,
  );
  window.addEventListener("blur", () => open.length && closeAll(false));
  window.addEventListener("resize", () => open.length && closeAll(false));

  // Alt or F10 moves to the bar; Alt and a letter opens a menu.
  function focusBar() {
    if (document.querySelector("dialog[open]")) return;
    const first = visibleTops()[0];
    if (!root.contains(document.activeElement))
      returnTo = document.activeElement;
    root.classList.add("show-keys");
    setStop(first);
    first.focus();
  }
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Alt") {
        altAlone = !e.ctrlKey && !e.shiftKey && !e.metaKey;
        return;
      }
      altAlone = false;
      if (document.querySelector("dialog[open]")) return;
      if (
        e.key === "F10" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        focusBar();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const letter = e.key.toLowerCase(),
          hit = tops.find((t) => t.menu.mnemonic === letter);
        if (hit) {
          e.preventDefault();
          const button =
            getComputedStyle(fold).display !== "none" ? fold : hit.button;
          if (!root.contains(document.activeElement))
            returnTo = document.activeElement;
          const popup = openFor(button, "keyboard");
          // On a phone the fold button opens the list of menus; open the right one.
          if (button === fold && popup) {
            const row = itemsOf(popup).find((i) =>
              i.textContent
                .trim()
                .toLowerCase()
                .startsWith(hit.menu.label.toLowerCase()),
            );
            row?.click();
          }
        }
      }
    },
    true,
  );
  document.addEventListener("keyup", (e) => {
    if (e.key === "Alt" && altAlone) {
      altAlone = false;
      if (open.length) closeAll(true);
      else if (root.contains(document.activeElement)) {
        root.classList.remove("show-keys");
        if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
        returnTo = null;
      } else focusBar();
    }
  });

  return {
    close: () => closeAll(false),
    isOpen: () => open.length > 0,
    focusBar,
  };
}
