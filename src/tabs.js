// The desktop strip and compact phone picker share the same document actions.
export function createTabs({
  root,
  list,
  picker,
  add,
  close,
  choose,
  remove,
  reorder,
}) {
  let dragged = null;
  let last = "";
  add.onclick = () => document.getElementById("fileInput").click();
  picker.onchange = () => choose(Number(picker.value));
  close.onclick = () => remove(Number(picker.value));
  list.onkeydown = (e) => {
    const buttons = [...list.querySelectorAll('[role="tab"]')],
      at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    let next;
    if (e.key === "ArrowRight") next = (at + 1) % buttons.length;
    else if (e.key === "ArrowLeft")
      next = (at + buttons.length - 1) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else if (e.key === "Delete") {
      e.preventDefault();
      remove(Number(buttons[at].dataset.id));
      return;
    } else return;
    e.preventDefault();
    const id = buttons[next].dataset.id;
    buttons[next].click();
    document.getElementById("document-" + id)?.focus();
  };
  return {
    render(documents, active, selected, busy) {
      const stamp = JSON.stringify([
        documents.map((d) => [d.id, d.name, d.edited, d.w, d.h]),
        active?.id,
        [...selected].map((d) => d.id),
        busy,
      ]);
      if (stamp === last) return;
      last = stamp;
      const focused =
        document.activeElement?.closest(".document-tab")?.dataset.id;
      list.replaceChildren(
        ...documents.map((doc) => {
          const group = document.createElement("div"),
            tab = document.createElement("button"),
            name = document.createElement("span"),
            x = document.createElement("span");
          group.className = "document-tab";
          group.dataset.id = doc.id;
          group.classList.toggle("active", doc === active);
          group.classList.toggle("selected", selected.has(doc));
          group.setAttribute("role", "presentation");
          group.draggable = !busy;
          tab.type = "button";
          tab.setAttribute("role", "tab");
          tab.dataset.id = doc.id;
          tab.id = "document-" + doc.id;
          tab.setAttribute("aria-selected", String(selected.has(doc)));
          tab.setAttribute("aria-controls", "main");
          tab.tabIndex = doc === active ? 0 : -1;
          tab.className = "document-button";
          name.className = "document-name";
          name.textContent = doc.name + (doc.edited ? " ●" : "");
          tab.setAttribute(
            "aria-description",
            "Press Delete or Ctrl+W to close this tab.",
          );
          tab.title =
            doc.name +
            " · " +
            doc.w +
            " × " +
            doc.h +
            (doc.still ? " · first frame" : "") +
            (doc.edited ? " · edits" : "") +
            "\nCtrl-click to select; Shift-click for a range. Drag to reorder.";
          tab.onclick = (e) =>
            e.target.closest(".document-close")
              ? remove(doc.id)
              : choose(doc.id, e);
          x.className = "document-close";
          x.textContent = "×";
          x.setAttribute("aria-hidden", "true");
          x.title = "Close " + doc.name;
          tab.disabled = busy;
          group.onauxclick = (e) => {
            if (e.button === 1) {
              e.preventDefault();
              remove(doc.id);
            }
          };
          group.ondragstart = (e) => {
            dragged = doc.id;
            e.dataTransfer.setData("text/x-hexshift-tab", String(doc.id));
            e.dataTransfer.effectAllowed = "move";
          };
          group.ondragover = (e) => {
            if (dragged !== null) {
              e.preventDefault();
              group.classList.add("tab-drop");
            }
          };
          group.ondragleave = () => group.classList.remove("tab-drop");
          group.ondrop = (e) => {
            if (dragged === null) return;
            e.preventDefault();
            e.stopPropagation();
            reorder(dragged, doc.id);
            dragged = null;
          };
          group.ondragend = () => {
            dragged = null;
            group.classList.remove("tab-drop");
          };
          tab.append(name, x);
          group.append(tab);
          return group;
        }),
      );
      picker.replaceChildren(
        ...documents.map((doc, i) => {
          const option = document.createElement("option");
          option.value = doc.id;
          option.textContent = `${i + 1} of ${documents.length} · ${doc.name}${doc.edited ? " ●" : ""}`;
          return option;
        }),
      );
      picker.value = active?.id ?? "";
      picker.disabled = close.disabled = busy || !documents.length;
      add.disabled = busy;
      root.dataset.count = documents.length;
      if (focused)
        list
          .querySelector(`[data-id="${focused}"] [role="tab"]`)
          ?.focus({ preventScroll: true });
    },
    reveal(id, focus = false) {
      const tab = document.getElementById("document-" + id);
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (focus) tab?.focus({ preventScroll: true });
    },
  };
}
