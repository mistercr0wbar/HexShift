// The workspace: where the panels sit.
//
// At full screen the page has three columns: Selection on the left, the image and
// the colour map in the middle, and Colour, Adjust, Swatches, Outline and Export on
// the right. Narrower windows fold the same panels into one right column, a dock
// under the image, or (on phones) a sheet with a tab bar. Panels are moved between
// places, never rebuilt, so their controls keep their listeners and state.
//
// Nothing here is stored: collapsed panels and column widths last for the session.

export const PANELS = [
  "selection",
  "colour",
  "adjust",
  "swatches",
  "outline",
  "export",
];
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
// Panels that start collapsed, in this order, when the columns cannot hold them
// all at the window's height.
export const AUTO_COLLAPSE = ["swatches", "outline"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Makes a drag handle (and its arrow keys) set a size. `read` gives the current
// size in px; `write` receives the new one.
function resizer(handle, { axis, invert, min, max, read, write, step = 16 }) {
  const set = (value) => {
    const v = Math.round(clamp(value, min(), Math.max(min(), max())));
    write(v);
    handle.setAttribute("aria-valuenow", String(v));
    handle.setAttribute("aria-valuemax", String(Math.round(max())));
  };
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = axis === "x" ? e.clientX : e.clientY,
      from = read();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    const move = (m) => {
      const d = (axis === "x" ? m.clientX : m.clientY) - start;
      set(from + (invert ? -d : d));
    };
    const stop = () => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
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
    set(read() + (e.key === forward ? by : -by) * (invert ? -1 : 1));
  });
  return set;
}

// `main` is the <main> element: it holds the three regions ([data-region]), the
// panels ([data-panel]) and the handles that resize them.
export function createWorkspace(main, { onPreset } = {}) {
  const app = main.closest(".app"),
    panels = Object.fromEntries(
      PANELS.map((id) => [id, main.querySelector(`[data-panel="${id}"]`)]),
    ),
    regions = Object.fromEntries(
      ["left", "right", "bottom"].map((name) => [
        name,
        main.querySelector(`[data-region="${name}"]`),
      ]),
    ),
    collapsed = new Set(),
    touched = new Set();
  let preset = null;

  function renderCollapse() {
    for (const id of PANELS) {
      const panel = panels[id],
        // Phones show the active tab's panels whole; nothing collapses there.
        shut = collapsed.has(id) && preset !== "phone",
        toggle = panel.querySelector(".panel-toggle");
      panel.dataset.collapsed = String(shut);
      panel.querySelector(".panel-body").hidden = shut;
      toggle?.setAttribute("aria-expanded", String(!shut));
    }
  }
  function place(next) {
    const plan = PRESETS[next];
    for (const [name, region] of Object.entries(regions)) {
      const stacks = region.querySelector(".stacks"),
        wanted = plan[name];
      stacks.replaceChildren(
        ...wanted.map((ids) => {
          const stack = document.createElement("div");
          stack.className = "stack";
          stack.append(...ids.map((id) => panels[id]));
          return stack;
        }),
      );
      region.hidden = !wanted.length;
    }
    preset = next;
    main.dataset.preset = next;
    renderCollapse();
  }
  // The page's own width, which is what the stylesheet's container queries see
  // (it differs from the window's only under a CSS zoom).
  function current() {
    return presetFor(app.clientWidth, innerHeight);
  }
  const overflowing = () =>
    [...main.querySelectorAll(".stack")].some(
      (s) => s.scrollHeight > s.clientHeight + 1,
    );

  const api = {
    get preset() {
      return preset;
    },
    panels,
    isCollapsed: (id) => collapsed.has(id),
    setCollapsed(id, on, byPerson = true) {
      if (on) collapsed.add(id);
      else collapsed.delete(id);
      if (byPerson) touched.add(id);
      renderCollapse();
    },
    toggle(id) {
      api.setCollapsed(id, !collapsed.has(id));
    },
    // Moves the panels if the window has crossed into another layout.
    refresh() {
      const next = current();
      if (next === preset) return false;
      place(next);
      if (next === "side" || next === "column") api.fit();
      onPreset?.(next);
      return true;
    },
    // Collapses Swatches, then Outline, when the columns cannot hold every panel
    // at this height, so nothing needs scrolling. Panels the person has opened or
    // closed themselves are left alone.
    fit() {
      if (preset === "phone" || preset === "dock") return;
      for (const id of AUTO_COLLAPSE) {
        if (!overflowing()) return;
        if (!collapsed.has(id) && !touched.has(id)) {
          collapsed.add(id);
          renderCollapse();
        }
      }
    },
  };

  for (const panel of Object.values(panels))
    panel.querySelector(".panel-toggle")?.addEventListener("click", () => {
      const id = panel.dataset.panel;
      if (preset !== "phone") api.toggle(id);
    });

  // Column widths and the dock height, set as CSS variables on the app.
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
          width() -
            360 -
            (regions[other].hidden ? 0 : regions[other].offsetWidth),
        ),
      read: () => regions[name].offsetWidth,
      write: (v) => px("--col-" + name, v),
    });
  side(main.querySelector("#splitLeft"), "left", "right", false);
  side(main.querySelector("#splitRight"), "right", "left", true);
  api.dockHeight = resizer(main.querySelector("#dockHandle"), {
    axis: "y",
    invert: true,
    min: () => 120,
    max: () => Math.min(600, Math.max(160, innerHeight - 320)),
    read: () => regions.bottom.offsetHeight,
    write: (v) => px("--dock-h", v),
  });

  place(current());
  api.fit();
  return api;
}
