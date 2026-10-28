// The workspace: where the panels sit.
//
// At full screen the page has three columns: Selection on the left, the image and
// the colour map in the middle, and Colour, Adjust, Swatches, Outline and Export on
// the right. Narrower windows fold the same panels into one right column, a dock
// under the image, or (on phones) a sheet with a tab bar. Panels are moved between
// places, never rebuilt, so their controls keep their listeners and state.
//
// A change the person makes (a drag, a menu move, a fold, a resize, a preset) is
// kept in localStorage as hexshift-layout. Fitting a short window, and the automatic
// choice of columns, is not written: reloading a short window may fold Swatches
// again, and a panel the person has opened stays open.

import {
  LAYOUT_KEY,
  PANELS,
  SPAN_LIMITS,
  fitSavedSizes,
  applyPreset,
  defaultLayout,
  hidePanel,
  insertPanel,
  locate,
  materialize,
  moveBy,
  movePhoneTab,
  moveToRegion,
  panelTitle,
  parseLayout,
  placement,
  regionSpoken,
  showPanel,
  validateLayout,
} from "./layout.js";

export { PANELS };
// For each layout, the panels in each region. A region holds one or more stacks
// (the dock has three side by side); a stack lists its panels top to bottom.
export const PRESETS = {
  side: { left: [["selection"]], right: [PANELS.slice(1)], bottom: [] },
  column: { left: [], right: [PANELS.slice()], bottom: [] },
  dock: {
    left: [],
    right: [],
    bottom: [
      ["selection"],
      ["colour", "adjust"],
      ["swatches", "outline", "export"],
    ],
  },
  phone: { left: [], right: [], bottom: [PANELS.slice()] },
};
// Widest first: a window this wide (or wider) in landscape gets side columns.
export const SIDE_MIN = 1100,
  PHONE_MAX = 759;
// Which layout fits a window of this size.
export function presetFor(width, height) {
  if (width <= PHONE_MAX) return "phone";
  if (width < height) return "dock";
  return width >= SIDE_MIN ? "side" : "column";
}
// Panels folded, in this order, while a column still cannot hold them. Swatches,
// then Outline, on every desktop layout. One right column is taller than the
// two-column layout, so that preset also folds Export, then Selection, if it
// still overflows. Side columns and the dock stop after Outline: opening a
// panel there must not fold Export out from under the recipe controls.
export const AUTO_COLLAPSE = ["swatches", "outline", "export", "selection"];

const PHONE_GROUPS = {
  selection: ["selection"],
  colour: ["colour", "adjust"],
  swatches: ["swatches"],
  export: ["outline", "export"],
};
const TAB_LABEL = {
  selection: "Selection",
  colour: "Colour",
  swatches: "Swatches",
  export: "Export",
};
const PRESET_SPOKEN = {
  side: "Side columns.",
  dock: "Bottom dock.",
  column: "One right column.",
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tabOf = (id) =>
  id === "colour" || id === "adjust"
    ? "colour"
    : id === "outline" || id === "export"
      ? "export"
      : id;

// Makes a drag handle (and its arrow keys) set a size. `read` gives the current
// size in px; `write` receives the new one. `commit` runs once the drag or key
// has actually changed it.
function resizer(
  handle,
  { axis, invert, min, max, read, write, step = 16, locked, commit, announce },
) {
  const set = (value) => {
    const v = Math.round(clamp(value, min(), Math.max(min(), max())));
    write(v);
    handle.setAttribute("aria-valuenow", String(v));
    handle.setAttribute("aria-valuemax", String(Math.round(max())));
    return v;
  };
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (locked?.()) {
      announce?.("Layout is locked.");
      return;
    }
    e.preventDefault();
    const start = axis === "x" ? e.clientX : e.clientY,
      from = read();
    let moved = false;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    const move = (m) => {
      moved = true;
      const d = (axis === "x" ? m.clientX : m.clientY) - start;
      set(from + (invert ? -d : d));
    };
    const stop = () => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (moved) commit?.(Number(handle.getAttribute("aria-valuenow")));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
  // The arrows move the handle: right or down is forward, left or up is back. A
  // handle whose size grows the other way (the right column, the dock) is inverted.
  handle.addEventListener("keydown", (e) => {
    const by = e.shiftKey ? step * 4 : step,
      forward = axis === "x" ? "ArrowRight" : "ArrowDown",
      back = axis === "x" ? "ArrowLeft" : "ArrowUp";
    if (e.key !== forward && e.key !== back) return;
    e.preventDefault();
    if (locked?.()) {
      announce?.("Layout is locked.");
      return;
    }
    const v = set(read() + (e.key === forward ? by : -by) * (invert ? -1 : 1));
    commit?.(v);
  });
  return set;
}

// `main` is the <main> element: it holds the three regions ([data-region]), the
// panels ([data-panel]) and the handles that resize them.
export function createWorkspace(main, opts = {}) {
  const { onPreset, report } = opts,
    storage = opts.storage || (() => localStorage),
    app = main.closest(".app"),
    panels = Object.fromEntries(
      PANELS.map((id) => [id, main.querySelector(`[data-panel="${id}"]`)]),
    ),
    regions = Object.fromEntries(
      ["left", "right", "bottom"].map((name) => [
        name,
        main.querySelector(`[data-region="${name}"]`),
      ]),
    ),
    indicator = document.getElementById("dropIndicator");
  const park = document.createElement("div");
  park.id = "panelPark";
  park.hidden = true;
  main.append(park);

  let layout = defaultLayout(),
    warning = "",
    preset = null,
    lastDesktop = "side",
    ready = false,
    announceToken = 0,
    openFor = null,
    openButton = null;
  const collapsed = new Set(),
    touched = new Set();

  try {
    const text = storage()?.getItem(LAYOUT_KEY);
    if (text != null) layout = parseLayout(text);
  } catch {
    layout = defaultLayout();
    warning = "Saved layout could not be read and was ignored.";
  }
  for (const id of layout.collapsed) collapsed.add(id);
  for (const id of layout.touched) touched.add(id);

  function announce(text) {
    const live = document.getElementById("layoutLive");
    if (!live || !text) return;
    const token = ++announceToken;
    live.textContent = "";
    queueMicrotask(() => {
      if (token === announceToken) live.textContent = text;
    });
  }
  function persist() {
    try {
      const clean = validateLayout(layout),
        store = storage();
      if (!store) throw Error("unavailable");
      store.setItem(LAYOUT_KEY, JSON.stringify(clean));
      layout = clean;
      return true;
    } catch {
      return false;
    }
  }
  function failSave(previous, folds, touchedIds) {
    layout = previous;
    collapsed.clear();
    touched.clear();
    for (const id of folds) collapsed.add(id);
    for (const id of touchedIds) touched.add(id);
    report?.("Could not save the layout.");
  }
  // Copies the arrangement on screen into the saved regions before a move, so the
  // edit matches what is showing. A phone uses the last desktop arrangement.
  function editing() {
    if (layout.mode === "custom") return layout;
    const kind =
      preset === "side" || preset === "column" || preset === "dock"
        ? preset
        : lastDesktop || "side";
    return materialize(layout, kind, PRESETS);
  }
  function visualPlan() {
    if (preset === "custom") return placement(layout, "custom", PRESETS);
    if (preset === "side" || preset === "column" || preset === "dock")
      return placement(layout, preset, PRESETS);
    return null;
  }
  const visualLocate = (id) => {
    const plan = visualPlan();
    return plan ? locate(plan, id) : null;
  };
  function commit(result, message) {
    if (!result?.changed) {
      if (result?.reason === "locked") announce("Layout is locked.");
      return false;
    }
    const previous = layout,
      folds = [...collapsed],
      touchedIds = [...touched];
    layout = result.layout;
    collapsed.clear();
    touched.clear();
    for (const id of layout.collapsed) collapsed.add(id);
    for (const id of layout.touched) touched.add(id);
    if (!persist()) {
      failSave(previous, folds, touchedIds);
      return false;
    }
    applyCurrent();
    fit();
    if (message) announce(message);
    onPreset?.();
    return true;
  }
  function saveSize(key, value) {
    if (!ready || layout.locked || layout.sizes[key] === value) return;
    const previous = layout,
      folds = [...collapsed],
      touchedIds = [...touched];
    layout = { ...layout, sizes: { ...layout.sizes, [key]: value } };
    if (!persist()) failSave(previous, folds, touchedIds);
  }
  function saveSpan(id, value) {
    if (!ready || layout.locked || layout.spans[id] === value) return;
    const previous = layout,
      folds = [...collapsed],
      touchedIds = [...touched];
    layout = { ...layout, spans: { ...layout.spans, [id]: value } };
    if (!persist()) failSave(previous, folds, touchedIds);
  }

  function renderCollapse() {
    for (const id of PANELS) {
      const panel = panels[id],
        shut = collapsed.has(id) && preset !== "phone",
        toggle = panel.querySelector(".panel-toggle");
      panel.dataset.collapsed = String(shut);
      panel.querySelector(".panel-body").hidden = shut;
      toggle?.setAttribute("aria-expanded", String(!shut));
      if (shut || preset === "phone" || layout.spans[id] == null)
        panel.style.height = "";
      else panel.style.height = layout.spans[id] + "px";
    }
  }
  function refreshSplits() {
    for (const old of main.querySelectorAll(".panel-split")) old.remove();
    if (preset === "phone") return;
    for (const stack of main.querySelectorAll(".region:not([hidden]) .stack")) {
      const items = [...stack.querySelectorAll(":scope > [data-panel]")];
      for (let i = 0; i < items.length - 1; i++) {
        const id = items[i].dataset.panel;
        if (collapsed.has(id)) continue;
        items[i].after(makeSplit(id));
      }
    }
  }
  function makeSplit(id) {
    const handle = document.createElement("div");
    handle.className = "panel-split";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "horizontal");
    handle.setAttribute("aria-label", "Resize " + panelTitle(id));
    handle.setAttribute("aria-valuemin", String(SPAN_LIMITS[0]));
    handle.setAttribute("aria-valuemax", String(SPAN_LIMITS[1]));
    // A separator that publishes a range has to publish its current value too.
    // The drag updates it; this is the value axe sees before anyone touches it.
    const span = clamp(
      panels[id].offsetHeight || SPAN_LIMITS[0],
      SPAN_LIMITS[0],
      SPAN_LIMITS[1],
    );
    handle.setAttribute("aria-valuenow", String(span));
    handle.tabIndex = layout.locked ? -1 : 0;
    resizer(handle, {
      axis: "y",
      invert: false,
      min: () => SPAN_LIMITS[0],
      max: () => SPAN_LIMITS[1],
      read: () => panels[id].offsetHeight,
      write: (v) => (panels[id].style.height = v + "px"),
      locked: () => layout.locked,
      announce,
      commit: (v) => saveSpan(id, v),
    });
    return handle;
  }
  function phoneOrder() {
    const hidden = new Set(layout.hidden),
      ids = [];
    for (const tab of layout.phoneTabs)
      for (const id of PHONE_GROUPS[tab]) if (!hidden.has(id)) ids.push(id);
    return ids;
  }
  function place(plan) {
    const shown = new Set();
    for (const [name, region] of Object.entries(regions)) {
      const stacks = region.querySelector(".stacks"),
        wanted = (plan[name] || []).filter((ids) => ids.length);
      stacks.replaceChildren(
        ...wanted.map((ids) => {
          const stack = document.createElement("div");
          stack.className = "stack";
          for (const id of ids) {
            shown.add(id);
            stack.append(panels[id]);
          }
          return stack;
        }),
      );
      region.hidden = !wanted.length;
    }
    for (const id of PANELS) if (!shown.has(id)) park.append(panels[id]);
  }
  function clearInlineGrid() {
    main.style.gridTemplateColumns = "";
    main.style.gridTemplateRows = "";
    main.style.gridTemplateAreas = "";
  }
  function setCustomGrid(plan) {
    const columns = [],
      top = [];
    if (plan.left.length) {
      columns.push("var(--col-left)");
      top.push("left");
    }
    columns.push("minmax(0, 1fr)");
    top.push("centre");
    if (plan.right.length) {
      columns.push("var(--col-right)");
      top.push("right");
    }
    main.style.gridTemplateColumns = columns.join(" ");
    if (plan.bottom.length) {
      const bottom = Array(columns.length).fill("bottom").join(" ");
      main.style.gridTemplateRows = "minmax(220px, 1fr) var(--dock-h)";
      main.style.gridTemplateAreas = `"${top.join(" ")}" "${bottom}"`;
    } else {
      main.style.gridTemplateRows = "minmax(0, 1fr)";
      main.style.gridTemplateAreas = `"${top.join(" ")}"`;
    }
  }
  function applySizes({ replace = true } = {}) {
    const names = { left: "--col-left", right: "--col-right", dock: "--dock-h" };
    if (preset === "phone") {
      if (replace)
        for (const cssName of Object.values(names))
          app.style.removeProperty(cssName);
      return;
    }
    // Hidden regions do not spend the picture's reserve. Preferred sizes stay
    // in `layout.sizes`; only the variables on the page change.
    const fitted = fitSavedSizes(layout.sizes, {
      width: main.clientWidth,
      height: main.clientHeight,
      left: !regions.left.hidden,
      right: !regions.right.hidden,
      bottom: !regions.bottom.hidden,
    });
    for (const [key, cssName] of Object.entries(names)) {
      const value = fitted[key];
      if (layout.sizes[key] == null || value == null) {
        if (replace) app.style.removeProperty(cssName);
        continue;
      }
      app.style.setProperty(cssName, value + "px");
    }
  }
  function syncPhoneTabs() {
    const bar = main.querySelector(".dock-tabs"),
      hidden = new Set(layout.hidden);
    for (const tab of layout.phoneTabs) {
      const button = bar.querySelector(`[data-tab="${tab}"]`);
      bar.append(button);
      button.hidden = !PHONE_GROUPS[tab].some((id) => !hidden.has(id));
    }
    const dock = regions.bottom;
    const current = bar.querySelector(`[data-tab="${dock.dataset.tab}"]`);
    if (!current || current.hidden) {
      const first = [...bar.children].find((button) => !button.hidden);
      if (first) dock.dataset.tab = first.dataset.tab;
    }
    for (const button of bar.children)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.tab === dock.dataset.tab && !button.hidden),
      );
  }
  function syncSplitters() {
    const phone = preset === "phone";
    main.querySelector("#splitLeft").hidden = phone || regions.left.hidden;
    main.querySelector("#splitRight").hidden = phone || regions.right.hidden;
    main.querySelector("#dockHandle").hidden = phone || regions.bottom.hidden;
  }
  function syncLocks() {
    for (const el of main.querySelectorAll(".splitter, .panel-split")) {
      el.tabIndex = layout.locked ? -1 : 0;
      if (layout.locked) el.setAttribute("aria-disabled", "true");
      else el.removeAttribute("aria-disabled");
    }
  }
  function presented() {
    if (app.clientWidth <= PHONE_MAX) return "phone";
    if (layout.mode === "custom") return "custom";
    if (layout.mode === "auto") return presetFor(app.clientWidth, innerHeight);
    return layout.mode;
  }
  function applyCurrent() {
    closeMenu();
    const next = presented();
    if (next === "side" || next === "column" || next === "dock")
      lastDesktop = next;
    preset = next;
    main.dataset.preset = next;
    clearInlineGrid();
    if (next === "phone") {
      const ids = phoneOrder();
      place({ left: [], right: [], bottom: ids.length ? [ids] : [] });
    } else if (next === "custom") {
      const plan = placement(layout, "custom", PRESETS);
      setCustomGrid(plan);
      place(plan);
    } else place(placement(layout, next, PRESETS));
    syncSplitters();
    renderCollapse();
    syncPhoneTabs();
    refreshSplits();
    syncLocks();
    applySizes({ replace: true });
  }
  const overflowing = () =>
    [...main.querySelectorAll(".region:not([hidden]) .stack")].some(
      (s) => s.scrollHeight > s.clientHeight + 1,
    );
  function foldAuto() {
    const order =
      preset === "column" ? AUTO_COLLAPSE : AUTO_COLLAPSE.slice(0, 2);
    for (const id of order) {
      if (!overflowing()) return;
      if (!collapsed.has(id) && !touched.has(id) && !layout.hidden.includes(id)) {
        collapsed.add(id);
        renderCollapse();
      }
    }
  }
  function growDock() {
    if (layout.sizes.dock != null) return;
    const cap = Math.min(600, Math.max(160, innerHeight - 320));
    for (let guard = 0; guard < 40 && overflowing(); guard++) {
      const height = regions.bottom.offsetHeight;
      if (height + 16 > cap) return;
      app.style.setProperty("--dock-h", Math.min(cap, height + 16) + "px");
    }
  }
  function fit() {
    if (preset === "phone" || preset === "custom") {
      refreshSplits();
      return;
    }
    if (preset === "dock") {
      if (layout.mode === "dock") {
        growDock();
        foldAuto();
      }
      refreshSplits();
      return;
    }
    foldAuto();
    refreshSplits();
  }

  function chosen() {
    if (
      layout.mode === "side" ||
      layout.mode === "column" ||
      layout.mode === "dock"
    )
      return layout.mode;
    if (layout.mode === "custom") return null;
    if (preset === "side" || preset === "column" || preset === "dock")
      return preset;
    return lastDesktop || "side";
  }
  function focusPanel(id) {
    const own = panels[id]?.querySelector(".panel-menu");
    if (own && own.getClientRects().length) {
      own.focus();
      return;
    }
    for (const other of PANELS) {
      const button = panels[other].querySelector(".panel-menu");
      if (button && button.getClientRects().length) {
        button.focus();
        return;
      }
    }
  }
  function tryRegion(id, region) {
    closeMenu();
    if (layout.locked) {
      announce("Layout is locked.");
      return;
    }
    commit(
      moveToRegion(editing(), id, region),
      panelTitle(id) + " moved to " + regionSpoken(region) + ".",
    );
    focusPanel(id);
  }
  function tryBy(id, delta) {
    closeMenu();
    if (layout.locked) {
      announce("Layout is locked.");
      return;
    }
    commit(
      moveBy(editing(), id, delta),
      panelTitle(id) + " moved " + (delta < 0 ? "up" : "down") + ".",
    );
    focusPanel(id);
  }
  function tryHide(id) {
    closeMenu();
    if (layout.locked) {
      announce("Layout is locked.");
      return;
    }
    commit(hidePanel(editing(), id), panelTitle(id) + " hidden.");
    focusPanel(id);
  }
  function tryPhone(id, delta) {
    const tab = tabOf(id);
    closeMenu();
    if (layout.locked) {
      announce("Layout is locked.");
      return;
    }
    commit(
      movePhoneTab(layout, tab, delta),
      TAB_LABEL[tab] + " tab moved " + (delta < 0 ? "earlier" : "later") + ".",
    );
    focusPanel(id);
  }
  function toggleHidden(id) {
    if (layout.locked) {
      announce("Layout is locked.");
      return;
    }
    if (layout.hidden.includes(id)) {
      const kind =
        preset === "side" || preset === "column" || preset === "dock"
          ? preset
          : lastDesktop || "side";
      commit(
        showPanel(editing(), id, kind === "dock" ? "bottom" : "right"),
        panelTitle(id) + " shown.",
      );
    } else commit(hidePanel(editing(), id), panelTitle(id) + " hidden.");
  }
  function usePreset(name) {
    if (layout.locked) {
      announce("Layout is locked.");
      return;
    }
    commit(applyPreset(layout, name, PRESETS), PRESET_SPOKEN[name]);
  }
  function setLocked(on) {
    if (layout.locked === !!on) return;
    const previous = layout,
      folds = [...collapsed],
      touchedIds = [...touched];
    layout = { ...layout, locked: !!on };
    if (!persist()) {
      failSave(previous, folds, touchedIds);
      return;
    }
    syncLocks();
    announce(on ? "Layout locked." : "Layout unlocked.");
  }
  function reset() {
    try {
      storage()?.removeItem(LAYOUT_KEY);
    } catch {
      report?.("Could not save the layout.");
      return;
    }
    layout = defaultLayout();
    collapsed.clear();
    touched.clear();
    for (const name of ["--col-left", "--col-right", "--dock-h"])
      app.style.removeProperty(name);
    for (const id of PANELS) panels[id].style.height = "";
    applyCurrent();
    fit();
    announce("Layout reset.");
    onPreset?.();
  }

  const popup = document.createElement("div");
  popup.className = "menu-pop";
  popup.tabIndex = -1;
  popup.setAttribute("role", "menu");
  function closeMenu() {
    popup.remove();
    openFor = null;
    if (openButton) openButton.setAttribute("aria-expanded", "false");
    openButton = null;
  }
  function menuItems(id) {
    const locked = layout.locked,
      shown = PANELS.length - layout.hidden.length;
    if (preset === "phone") {
      const tab = tabOf(id),
        index = layout.phoneTabs.indexOf(tab);
      return [
        ["Move tab earlier", locked || index <= 0, () => tryPhone(id, -1)],
        [
          "Move tab later",
          locked || index >= layout.phoneTabs.length - 1,
          () => tryPhone(id, 1),
        ],
        ["Hide", locked || shown <= 1, () => tryHide(id)],
      ];
    }
    const loc = visualLocate(id),
      stack = loc ? visualPlan()[loc.region][loc.stack] : [];
    return [
      ["Move to left column", locked || loc?.region === "left", () => tryRegion(id, "left")],
      [
        "Move to right column",
        locked || loc?.region === "right",
        () => tryRegion(id, "right"),
      ],
      ["Move to bottom", locked || loc?.region === "bottom", () => tryRegion(id, "bottom")],
      ["Move up", locked || !loc || loc.index === 0, () => tryBy(id, -1)],
      [
        "Move down",
        locked || !loc || loc.index >= stack.length - 1,
        () => tryBy(id, 1),
      ],
      ["Hide", locked || shown <= 1, () => tryHide(id)],
    ];
  }
  function openMenu(id, button, which = "first") {
    closeMenu();
    openFor = id;
    openButton = button;
    button.setAttribute("aria-expanded", "true");
    popup.setAttribute("aria-label", panelTitle(id) + " panel");
    popup.replaceChildren(
      ...menuItems(id).map(([label, disabled, run]) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "menu-item";
        row.tabIndex = -1;
        row.setAttribute("role", "menuitem");
        const mark = document.createElement("span");
        mark.className = "menu-mark";
        mark.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.className = "menu-label";
        text.textContent = label;
        row.append(mark, text);
        if (disabled) row.setAttribute("aria-disabled", "true");
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (row.getAttribute("aria-disabled") === "true") return;
          run();
        });
        return row;
      }),
    );
    document.body.append(popup);
    const rect = button.getBoundingClientRect(),
      width = popup.offsetWidth,
      height = popup.offsetHeight;
    let left = rect.left,
      top = rect.bottom + 2;
    if (left + width > innerWidth - 4) left = innerWidth - 4 - width;
    if (top + height > innerHeight - 4) top = Math.max(4, rect.top - height - 2);
    popup.style.left = Math.max(4, left) + "px";
    popup.style.top = top + "px";
    const items = [...popup.querySelectorAll('[role="menuitem"]')];
    items[which === "last" ? items.length - 1 : 0]?.focus();
  }
  popup.addEventListener("keydown", (e) => {
    const items = [...popup.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      const back = openButton;
      closeMenu();
      back?.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!popup.isConnected) return;
    if (popup.contains(e.target) || e.target.closest?.(".panel-menu")) return;
    closeMenu();
  });

  function adorn(panel) {
    const id = panel.dataset.panel,
      head = panel.querySelector(".panel-head"),
      grip = document.createElement("div"),
      button = document.createElement("button");
    grip.className = "panel-grip";
    grip.setAttribute("aria-hidden", "true");
    button.type = "button";
    button.className = "panel-menu";
    button.textContent = "…";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", panelTitle(id) + " panel");
    head.prepend(grip);
    head.querySelector("h2").after(button);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openFor === id) closeMenu();
      else openMenu(id, button);
    });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      e.stopPropagation();
      openMenu(id, button, e.key === "ArrowUp" ? "last" : "first");
    });
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || preset === "phone") return;
      if (layout.locked) {
        announce("Layout is locked.");
        return;
      }
      e.preventDefault();
      closeMenu();
      const startX = e.clientX,
        startY = e.clientY;
      let dragging = false;
      grip.setPointerCapture(e.pointerId);
      const move = (m) => {
        if (!dragging) {
          if (Math.hypot(m.clientX - startX, m.clientY - startY) < 4) return;
          dragging = true;
        }
        const hit = hitTest(m.clientX, m.clientY);
        if (hit) showIndicator(hit);
        else if (indicator) indicator.hidden = true;
      };
      const stop = (m) => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", stop);
        grip.removeEventListener("pointercancel", stop);
        const dropped = dragging && m.type !== "pointercancel";
        dragging = false;
        if (indicator) indicator.hidden = true;
        if (!dropped) return;
        const hit = hitTest(m.clientX, m.clientY);
        if (!hit) return;
        const before = visualLocate(id),
          result = insertPanel(editing(), id, hit);
        if (!result.changed) return;
        commit(
          result,
          dragMessage(id, before, locate(result.layout.regions, id)),
        );
        focusPanel(id);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", stop);
      grip.addEventListener("pointercancel", stop);
    });
  }
  function endOf(name) {
    const plan = visualPlan();
    const stacks = plan?.[name] || [];
    if (!stacks.length) return { region: name, stack: 0, index: 0 };
    return {
      region: name,
      stack: stacks.length - 1,
      index: stacks[stacks.length - 1].length,
    };
  }
  function hitTest(x, y) {
    const bounds = main.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)
      return null;
    const el = document.elementFromPoint(x, y);
    if (el?.classList?.contains("panel-split")) {
      const prev = el.previousElementSibling;
      const loc = prev?.dataset.panel ? visualLocate(prev.dataset.panel) : null;
      if (loc) return { region: loc.region, stack: loc.stack, index: loc.index + 1 };
    }
    if (el?.id === "splitLeft") return endOf("left");
    if (el?.id === "splitRight") return endOf("right");
    if (el?.id === "dockHandle") return endOf("bottom");
    const panel = el?.closest?.("[data-panel]");
    if (panel && main.contains(panel) && !panel.closest("#panelPark")) {
      const loc = visualLocate(panel.dataset.panel);
      if (!loc) return null;
      const rect = panel.getBoundingClientRect();
      const after = y > rect.top + rect.height / 2;
      return {
        region: loc.region,
        stack: loc.stack,
        index: loc.index + (after ? 1 : 0),
      };
    }
    const regionEl = el?.closest?.("[data-region]");
    if (regionEl && main.contains(regionEl)) {
      const name = regionEl.dataset.region,
        plan = visualPlan(),
        stacks = plan?.[name] || [];
      if (!stacks.length) return { region: name, stack: 0, index: 0 };
      const stackEls = [...regionEl.querySelectorAll(":scope > .stacks > .stack")];
      let stack = stackEls.length - 1;
      stackEls.forEach((node, i) => {
        const rect = node.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right) stack = i;
      });
      return { region: name, stack, index: (stacks[stack] || []).length };
    }
    if (regions.bottom.hidden && y > bounds.bottom - 48)
      return { region: "bottom", stack: 0, index: 0 };
    if (regions.left.hidden && x < bounds.left + 28)
      return { region: "left", stack: 0, index: 0 };
    if (regions.right.hidden && x > bounds.right - 28)
      return { region: "right", stack: 0, index: 0 };
    return null;
  }
  function showIndicator(hit) {
    if (!indicator) return;
    const box = indicatorBox(hit);
    if (!box) {
      indicator.hidden = true;
      return;
    }
    indicator.hidden = false;
    indicator.style.left = box.left + "px";
    indicator.style.top = box.top + "px";
    indicator.style.width = box.width + "px";
    indicator.style.height = box.height + "px";
  }
  function indicatorBox(hit) {
    const region = regions[hit.region];
    if (region.hidden) {
      const rect = main.getBoundingClientRect();
      if (hit.region === "bottom")
        return { left: rect.left, top: rect.bottom - 4, width: rect.width, height: 4 };
      if (hit.region === "left")
        return { left: rect.left, top: rect.top, width: 4, height: rect.height };
      return { left: rect.right - 4, top: rect.top, width: 4, height: rect.height };
    }
    const stack = region.querySelectorAll(":scope > .stacks > .stack")[hit.stack];
    const items = stack ? [...stack.querySelectorAll(":scope > [data-panel]")] : [];
    const panel = items[hit.index] || items.at(-1);
    if (!panel) {
      const rect = (stack || region).getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: 4 };
    }
    const rect = panel.getBoundingClientRect(),
      after = hit.index >= items.length;
    return {
      left: rect.left,
      top: (after ? rect.bottom : rect.top) - 2,
      width: rect.width,
      height: 4,
    };
  }
  function dragMessage(id, before, after) {
    const title = panelTitle(id);
    if (!before || !after) return title + " moved.";
    if (before.region !== after.region)
      return title + " moved to " + regionSpoken(after.region) + ".";
    if (before.stack === after.stack && after.index < before.index)
      return title + " moved up.";
    if (before.stack === after.stack && after.index > before.index)
      return title + " moved down.";
    return title + " moved to " + regionSpoken(after.region) + ".";
  }

  for (const panel of Object.values(panels)) {
    adorn(panel);
    panel.querySelector(".panel-toggle")?.addEventListener("click", () => {
      const id = panel.dataset.panel;
      if (preset !== "phone") api.toggle(id);
    });
  }

  const px = (name, value) => app.style.setProperty(name, value + "px"),
    width = () => app.clientWidth;
  const side = (el, name, other, invert) =>
    resizer(el, {
      axis: "x",
      invert,
      min: () => 200,
      max: () =>
        Math.min(
          520,
          width() - 360 - (regions[other].hidden ? 0 : regions[other].offsetWidth),
        ),
      read: () => regions[name].offsetWidth,
      write: (v) => px("--col-" + name, v),
      locked: () => layout.locked,
      announce,
      commit: (v) => saveSize(name, v),
    });
  side(main.querySelector("#splitLeft"), "left", "right", false);
  side(main.querySelector("#splitRight"), "right", "left", true);
  const api = {
    warning,
    get preset() {
      return preset;
    },
    panels,
    mode: () => layout.mode,
    chosen,
    isLocked: () => layout.locked,
    isHidden: (id) => layout.hidden.includes(id),
    shownCount: () => PANELS.length - layout.hidden.length,
    isCollapsed: (id) => collapsed.has(id),
    setCollapsed(id, on, byPerson = true) {
      if (!PANELS.includes(id)) return;
      const previous = layout,
        folds = [...collapsed],
        touchedIds = [...touched];
      if (on) collapsed.add(id);
      else collapsed.delete(id);
      if (byPerson) touched.add(id);
      if (byPerson && ready) {
        const nextCollapsed = previous.collapsed.filter((item) => item !== id);
        if (on) nextCollapsed.push(id);
        layout = {
          ...previous,
          collapsed: nextCollapsed,
          touched: PANELS.filter((item) => touched.has(item)),
        };
        if (!persist()) failSave(previous, folds, touchedIds);
      }
      renderCollapse();
      refreshSplits();
    },
    toggle(id) {
      api.setCollapsed(id, !collapsed.has(id));
    },
    usePreset,
    setLocked,
    toggleHidden,
    reset,
    refresh() {
      const next = presented();
      if (next === preset) {
        // The preset name did not change, so folds stay put. Saved column
        // sizes still have to fit the window that is on screen now.
        applySizes({ replace: false });
        return false;
      }
      applyCurrent();
      fit();
      onPreset?.(next);
      return true;
    },
    fit,
  };
  api.dockHeight = resizer(main.querySelector("#dockHandle"), {
    axis: "y",
    invert: true,
    min: () => 120,
    max: () => Math.min(600, Math.max(160, innerHeight - 320)),
    read: () => regions.bottom.offsetHeight,
    write: (v) => px("--dock-h", v),
    locked: () => layout.locked,
    announce,
    commit: (v) => saveSize("dock", v),
  });

  applyCurrent();
  fit();
  ready = true;
  return api;
}
