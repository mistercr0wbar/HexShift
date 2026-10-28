// Only colours explicitly saved by the person using the app live here. Images,
// edits and recent targets never enter this store. Read and write as bounded data.
export const COLOURS_KEY = "hexshift-colours",
  MAX_SAVED = 48,
  MAX_MY_PALETTES = 50,
  MAX_MY_COLOURS = 256,
  MAX_COLOURS_BYTES = 256 * 1024;
const empty = () => ({ v: 1, saved: [], palettes: [] });
const hex = (value) => {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    throw Error("Saved colours must be #RRGGBB.");
  return value.toUpperCase();
};
const label = (value, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > 60 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw Error("Palette names and labels must be at most 60 characters.");
  const text = value.trim();
  if (required && !text) throw Error("Give the palette a name.");
  return text;
};
export function validateColours(source) {
  if (
    source?.v !== 1 ||
    !Array.isArray(source.saved) ||
    !Array.isArray(source.palettes)
  )
    throw Error("This saved-colour format is not supported.");
  if (source.saved.length > MAX_SAVED)
    throw Error("You can save up to 48 colours.");
  if (source.palettes.length > MAX_MY_PALETTES)
    throw Error("You can keep up to 50 palettes.");
  const names = new Set();
  const data = {
    v: 1,
    saved: [...new Set(source.saved.map(hex))],
    palettes: source.palettes.map((palette) => {
      const name = label(palette?.name, true),
        key = name.toLowerCase();
      if (names.has(key))
        throw Error("A palette with that name already exists.");
      names.add(key);
      if (
        !Array.isArray(palette.colours) ||
        !palette.colours.length ||
        palette.colours.length > MAX_MY_COLOURS
      )
        throw Error("A saved palette has 1 to 256 colours.");
      return {
        name,
        colours: palette.colours.map((entry) => {
          const out = { hex: hex(entry?.hex) };
          if (entry.label !== undefined) out.label = label(entry.label);
          return out;
        }),
      };
    }),
  };
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_COLOURS_BYTES)
    throw Error("Saved colours and palettes must fit within 256 KB.");
  return data;
}
export function parseColours(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_COLOURS_BYTES
  )
    throw Error("Saved colours and palettes must fit within 256 KB.");
  return validateColours(JSON.parse(text));
}
export function createColourStore(storage, notify = () => {}) {
  let data = empty();
  const listeners = new Set();
  const api = {
    error: "",
    get: () => structuredClone(data),
    saved: () => data.saved.slice(),
    palette: (index) => structuredClone(data.palettes[index] ?? null),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    add(value) {
      return change((next) => {
        const colour = hex(value);
        if (next.saved.includes(colour))
          throw Error("That colour is already saved.");
        if (next.saved.length >= MAX_SAVED)
          throw Error(
            "All 48 saved-colour slots are full. Remove a colour first.",
          );
        next.saved.push(colour);
      }, "Colour saved.");
    },
    remove(index) {
      return change((next) => {
        if (!Number.isInteger(index) || index < 0 || index >= next.saved.length)
          throw Error("Choose a saved colour.");
        next.saved.splice(index, 1);
      }, "Saved colour removed.");
    },
    move(from, to) {
      return change((next) => {
        if (
          ![from, to].every(
            (n) => Number.isInteger(n) && n >= 0 && n < next.saved.length,
          )
        )
          throw Error("Choose a saved colour.");
        next.saved.splice(to, 0, next.saved.splice(from, 1)[0]);
      }, "Saved colour moved.");
    },
    savePalette(name, entries) {
      return change((next) => {
        next.palettes.push({
          name,
          colours: entries.map((entry) => ({
            hex: entry.hex,
            ...(entry.label === undefined ? {} : { label: entry.label }),
          })),
        });
      }, "Palette kept in My palettes.");
    },
    removePalette(index) {
      return change((next) => {
        next.palettes.splice(index, 1);
      }, "Palette removed from My palettes.");
    },
  };
  try {
    const text = storage()?.getItem(COLOURS_KEY);
    if (text !== null && text !== undefined) data = parseColours(text);
  } catch {
    notify("Saved colours could not be read and were ignored.");
  }
  function change(fn, message) {
    try {
      const next = structuredClone(data);
      fn(next);
      const clean = validateColours(next);
      const target = storage();
      if (!target) throw Error("Local colour storage is unavailable.");
      target.setItem(COLOURS_KEY, JSON.stringify(clean));
      data = clean;
      api.error = "";
    } catch (error) {
      api.error = "Could not save colours: " + error.message;
      notify(api.error);
      return false;
    }
    for (const listener of listeners) listener();
    notify(message);
    return true;
  }
  return api;
}
