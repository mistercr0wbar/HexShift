import { parseHex, toHex, clamp } from "./colour.js";
import { MAX_SAVED } from "./colours.js";

const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (text, fn, className = "text-button") => {
  const el = node("button", className, text);
  el.type = "button";
  el.onclick = fn;
  return el;
};
export function rgbToHsv(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d)
    h =
      max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return toHex(f(5), f(3), f(1));
}

// Both places use the same ordered colours and the same mouse, touch and keyboard
// actions. The picker also draws empty slots, so its size never changes on Save.
export function createSavedGrid(box, { store, onUse, slots = false }) {
  box.classList.add("saved-grid");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Saved colours");
  const menu = node("div", "saved-menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Saved colour actions");
  box.after(menu);
  let dragging = null,
    timer = 0,
    held = false,
    start = null,
    returnTo = null;
  const close = (focus = false) => {
    menu.hidden = true;
    if (focus) returnTo?.focus();
  };
  function focusIndex(index) {
    box
      .querySelectorAll("button")
      [Math.max(0, Math.min(index, store.saved().length - 1))]?.focus();
  }
  function context(index, anchor) {
    clearTimeout(timer);
    returnTo = anchor;
    const length = store.saved().length;
    const actions = [
      ["Move left", index - 1],
      ["Move right", index + 1],
      ["Move to start", 0],
      ["Move to end", length - 1],
      ["Remove colour", null],
    ];
    menu.replaceChildren(
      ...actions.map(([text, to]) => {
        const item = button(text, () => {
          close();
          if (to === null) store.remove(index);
          else store.move(index, to);
          focusIndex(to === null ? index : to);
        });
        item.setAttribute("role", "menuitem");
        item.disabled = to !== null && (to < 0 || to >= length || to === index);
        return item;
      }),
    );
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    menu.style.left =
      Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8)) +
      "px";
    menu.style.top =
      Math.max(8, Math.min(rect.bottom, innerHeight - menu.offsetHeight - 8)) +
      "px";
    menu.querySelector("button:not(:disabled)")?.focus();
  }
  menu.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
    const list = [...menu.querySelectorAll("button:not(:disabled)")];
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const at = list.indexOf(document.activeElement),
        direction = e.key === "ArrowUp" ? -1 : 1;
      list[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? list.length - 1
            : (at + direction + list.length) % list.length
      ]?.focus();
    }
  };
  document.addEventListener("pointerdown", (e) => {
    if (!menu.contains(e.target)) close();
  });
  function render() {
    close();
    const saved = store.saved();
    box.replaceChildren(
      ...Array.from({ length: slots ? MAX_SAVED : saved.length }, (_, i) => {
        const hex = saved[i],
          el = button(
            "",
            () => {
              if (!held) onUse(hex);
            },
            "swatch saved-slot",
          );
        el.disabled = !hex;
        el.setAttribute(
          "aria-label",
          hex
            ? "Use " + hex + ", saved colour " + (i + 1)
            : "Empty saved colour slot " + (i + 1),
        );
        el.title = hex
          ? hex +
            " · Right-click or hold for actions; Alt+arrows moves; Delete removes"
          : "Empty slot";
        if (!hex) return el;
        el.style.backgroundColor = hex;
        el.draggable = true;
        el.oncontextmenu = (e) => {
          e.preventDefault();
          context(i, el);
        };
        el.onkeydown = (e) => {
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            e.stopPropagation();
            context(i, el);
          } else if (e.key === "Delete") {
            e.preventDefault();
            store.remove(i);
            focusIndex(i);
          } else if (e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            const to = clamp(
              i + (e.key === "ArrowLeft" ? -1 : 1),
              0,
              saved.length - 1,
            );
            store.move(i, to);
            focusIndex(to);
          } else if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(e.key)
          ) {
            e.preventDefault();
            const columns =
              getComputedStyle(box).gridTemplateColumns.split(" ").length;
            focusIndex(
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? saved.length - 1
                  : i +
                    {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -columns,
                      ArrowDown: columns,
                    }[e.key],
            );
          }
        };
        el.onpointerdown = (e) => {
          held = false;
          start = [e.clientX, e.clientY];
          if (e.pointerType !== "mouse")
            timer = setTimeout(() => {
              held = true;
              context(i, el);
            }, 550);
        };
        el.onpointermove = (e) => {
          if (
            start &&
            Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6
          )
            clearTimeout(timer);
        };
        el.onpointerup = el.onpointercancel = () => clearTimeout(timer);
        el.ondragstart = (e) => {
          clearTimeout(timer);
          dragging = i;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", hex);
        };
        el.ondragend = () => {
          dragging = null;
        };
        el.ondragover = (e) => {
          if (dragging !== null) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        };
        el.ondrop = (e) => {
          if (dragging !== null) {
            e.preventDefault();
            e.stopPropagation();
            const from = dragging;
            dragging = null;
            store.move(from, i);
            focusIndex(i);
          }
        };
        return el;
      }),
    );
  }
  store.subscribe(render);
  render();
  return { render, close };
}

export function createPicker({ store, recent, pickScreen }) {
  const pop = node("div", "colour-picker");
  pop.id = "colourPicker";
  pop.setAttribute("popover", "auto");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-labelledby", "pickerTitle");
  const head = node("div", "picker-head"),
    title = node("h2", "", "Colour");
  title.id = "pickerTitle";
  const done = button("Done", () => pop.hidePopover());
  head.append(title, done);
  const square = node("div", "picker-square"),
    marker = node("span", "picker-marker");
  square.tabIndex = 0;
  square.setAttribute("role", "slider");
  square.setAttribute("aria-label", "Saturation and brightness");
  square.setAttribute("aria-valuemin", "0");
  square.setAttribute("aria-valuemax", "100");
  square.setAttribute("aria-describedby", "pickerKeys");
  square.append(marker);
  const keys = node(
    "p",
    "sr-only",
    "Left and right change saturation; up and down change brightness. Shift makes larger changes.",
  );
  keys.id = "pickerKeys";
  const hue = node("input", "picker-hue");
  hue.type = "range";
  hue.min = "0";
  hue.max = "360";
  hue.step = "1";
  hue.setAttribute("aria-label", "Hue");
  const fields = node("div", "picker-fields");
  const hexLabel = node("label", "", "Hex"),
    hexInput = node("input", "hex");
  hexInput.id = "pickerHex";
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.autocomplete = "off";
  hexLabel.append(hexInput);
  const channels = ["Red", "Green", "Blue"].map((name) => {
    const label = node("label", "", name[0]),
      input = node("input");
    input.type = "number";
    input.min = "0";
    input.max = "255";
    input.step = "1";
    input.setAttribute("aria-label", name);
    label.append(input);
    fields.append(label);
    return input;
  });
  fields.prepend(hexLabel);
  const screen = button("◎ Pick from screen", () => {
    const destination = active;
    pickScreen((hex) => {
      if (active === destination && pop.matches(":popover-open"))
        applyHex(hex, true);
      else {
        destination.input(hex);
        destination.commit();
      }
    });
  });
  screen.id = "pickerScreen";
  screen.hidden = !pickScreen;
  const savedHead = node("div", "picker-head"),
    savedLabel = node("span", "small-label", "Saved colours"),
    save = button("+ Save", () => store.add(value));
  save.id = "pickerSave";
  savedHead.append(savedLabel, save);
  const saved = node("div"),
    recentsHead = node("p", "small-label", "Recent"),
    recents = node("div", "swatches picker-recent");
  const message = node("p", "readout picker-message");
  message.setAttribute("role", "status");
  pop.append(
    head,
    square,
    keys,
    hue,
    fields,
    screen,
    savedHead,
    saved,
    recentsHead,
    recents,
    message,
  );
  document.body.append(pop);
  const grid = createSavedGrid(saved, {
    store,
    slots: true,
    onUse: (hex) => applyHex(hex, true),
  });
  let active = null,
    opener = null,
    value = "#000000",
    hsv = [0, 0, 0];
  function paint() {
    const [h, s, v] = hsv;
    square.style.setProperty("--picker-hue", hsvToHex(h, 1, 1));
    marker.style.left = s * 100 + "%";
    marker.style.top = (1 - v) * 100 + "%";
    square.setAttribute("aria-valuenow", String(Math.round(s * 100)));
    square.setAttribute(
      "aria-valuetext",
      Math.round(s * 100) +
        "% saturation, " +
        Math.round(v * 100) +
        "% brightness",
    );
    hue.value = String(h);
    if (document.activeElement !== hexInput) hexInput.value = value;
    const rgb = parseHex(value);
    channels.forEach((input, i) => {
      if (document.activeElement !== input) input.value = rgb[i];
    });
    save.disabled =
      store.saved().includes(value) || store.saved().length >= MAX_SAVED;
  }
  function applyHex(hex, commit = false, fromHsv = false) {
    const rgb = parseHex(hex);
    if (!rgb || !active) return;
    value = toHex(...rgb);
    if (!fromHsv) {
      const next = rgbToHsv(rgb);
      // Greys retain the hue so choosing a shade does not jump the strip to red.
      if (!next[1]) next[0] = hsv[0];
      hsv = next;
    }
    paint();
    active.input(value);
    if (commit) active.commit();
  }
  function fromSquare(e) {
    const r = square.getBoundingClientRect();
    hsv[1] = clamp((e.clientX - r.left) / r.width, 0, 1);
    hsv[2] = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    applyHex(hsvToHex(...hsv), false, true);
  }
  square.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    square.focus();
    square.setPointerCapture(e.pointerId);
    fromSquare(e);
  };
  square.onpointermove = (e) => {
    if (square.hasPointerCapture(e.pointerId)) fromSquare(e);
  };
  square.onpointerup = square.onpointercancel = (e) => {
    if (square.hasPointerCapture(e.pointerId)) {
      square.releasePointerCapture(e.pointerId);
      active?.commit();
    }
  };
  square.onkeydown = (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === "ArrowLeft") hsv[1] -= step;
    else if (e.key === "ArrowRight") hsv[1] += step;
    else if (e.key === "ArrowUp") hsv[2] += step;
    else if (e.key === "ArrowDown") hsv[2] -= step;
    else if (e.key === "Home") hsv[1] = 0;
    else if (e.key === "End") hsv[1] = 1;
    else return;
    e.preventDefault();
    hsv[1] = clamp(hsv[1], 0, 1);
    hsv[2] = clamp(hsv[2], 0, 1);
    applyHex(hsvToHex(...hsv), true, true);
  };
  hue.oninput = () => {
    hsv[0] = Number(hue.value);
    applyHex(hsvToHex(...hsv), false, true);
  };
  hue.onchange = () => active?.commit();
  hexInput.oninput = () => {
    const rgb = parseHex(hexInput.value);
    hexInput.setAttribute("aria-invalid", String(!rgb));
    if (rgb) applyHex(toHex(...rgb));
  };
  hexInput.onchange = () => {
    active?.commit();
    if (parseHex(hexInput.value)) hexInput.value = value;
  };
  const rgbInput = () => {
    const rgb = channels.map((input) =>
      input.value === "" ? NaN : Number(input.value),
    );
    const valid = rgb.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
    channels.forEach((input) =>
      input.setAttribute("aria-invalid", String(!valid)),
    );
    if (valid) applyHex(toHex(...rgb));
  };
  for (const input of channels) {
    input.oninput = rgbInput;
    input.onchange = () => active?.commit();
  }
  pop.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      pop.hidePopover();
    }
    if (e.key === "Tab") {
      const list = [
        ...pop.querySelectorAll("button:not(:disabled),input,[tabindex='0']"),
      ].filter((el) => el.getClientRects().length && !el.closest("[hidden]"));
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0].focus();
      }
    }
  };
  pop.addEventListener("beforetoggle", (e) => {
    if (e.newState === "closed") {
      active?.commit();
      grid.close();
      opener?.setAttribute("aria-expanded", "false");
    }
  });
  pop.addEventListener("toggle", (e) => {
    if (
      e.newState === "closed" &&
      (pop.contains(document.activeElement) ||
        document.activeElement === document.body)
    )
      opener?.focus();
  });
  store.subscribe(paint);
  function position() {
    const r = opener.getBoundingClientRect();
    pop.style.left =
      Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top =
      Math.max(8, Math.min(r.bottom + 4, innerHeight - pop.offsetHeight - 8)) +
      "px";
  }
  window.addEventListener("resize", () => {
    if (pop.matches(":popover-open")) position();
  });
  return {
    open(anchor, config) {
      if (pop.matches(":popover-open")) {
        pop.hidePopover();
        if (opener === anchor) return;
      }
      active = config;
      opener = anchor;
      value = config.get();
      hsv = rgbToHsv(parseHex(value));
      title.textContent = config.title;
      for (const input of [hexInput, ...channels])
        input.removeAttribute("aria-invalid");
      hexInput.value = value;
      channels.forEach((input, i) => {
        input.value = parseHex(value)[i];
      });
      recents.replaceChildren(
        ...recent().map((hex) => {
          const el = button("", () => applyHex(hex, true), "swatch");
          el.style.backgroundColor = hex;
          el.setAttribute("aria-label", "Use recent " + hex);
          return el;
        }),
      );
      recentsHead.hidden = recents.hidden = !recent().length;
      message.textContent = "Right-click or hold a saved colour for actions.";
      paint();
      pop.showPopover();
      anchor.setAttribute("aria-expanded", "true");
      position();
      square.focus();
    },
    message(text) {
      if (pop.matches(":popover-open")) message.textContent = text;
    },
  };
}
