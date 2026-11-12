// Character themes use the cr0wbots Accents palette for the uniforms, eyes
// and insignia in the updated character art. The canvas stays neutral.
// System takes its accent and app mode from the host when available.

const hex = (h) => h.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16));
const toHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
function luminance(h) {
  const [r, g, b] = hex(h).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// Moves a colour towards black or white, whichever needs the smaller change,
// until it reaches `target` contrast against every background.
function readable(colour, backgrounds, target) {
  const worst = (c) => Math.min(...backgrounds.map((b) => contrast(c, b)));
  if (worst(colour) >= target) return colour;
  let best = null,
    bestStep = Infinity;
  for (const end of ["#000000", "#ffffff"])
    for (let step = 1; step <= 50; step++) {
      const c = mix(colour, end, step / 50);
      if (worst(c) >= target) {
        if (step < bestStep) [best, bestStep] = [c, step];
        break;
      }
    }
  return best || (worst("#000000") > worst("#ffffff") ? "#000000" : "#ffffff");
}
function toHsl(h) {
  const [r, g, b] = hex(h).map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)),
    hue =
      max === r
        ? ((g - b) / d + 6) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  return [hue * 60, s, l];
}
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2,
    [r, g, b] =
      h < 60
        ? [c, x, 0]
        : h < 120
          ? [x, c, 0]
          : h < 180
            ? [0, c, x]
            : h < 240
              ? [0, x, c]
              : h < 300
                ? [x, 0, c]
                : [c, 0, x];
  return toHex([r + m, g + m, b + m].map((v) => v * 255));
}
// The Contrast accent: the main colour saturated and brightened until it
// stands out at 8:1 on black. A colourless main colour becomes white.
function amplify(colour) {
  const [h, s] = toHsl(colour);
  if (s < 0.12) return "#ffffff";
  const sat = Math.min(1, s * 1.4 + 0.25);
  for (let l = 0.5; l <= 0.9; l += 0.01) {
    const c = fromHsl(h, sat, l);
    if (contrast(c, "#000000") >= 8) return c;
  }
  return fromHsl(h, sat, 0.9);
}

// Deep, Dark, Base, Light and Lighter, in the same order as the GPL palette.
const neutral = ["#1a1a1a", "#4d4d4d", "#808080", "#b3b3b3", "#e6e6e6"];
const red = ["#990d2f", "#bc374a", "#df5866", "#ff7b86", "#ffb3b5"];
const orange = ["#843900", "#af4e00", "#da650c", "#fd853c", "#ffb892"];
const gold = ["#6f4900", "#946300", "#ba7e00", "#db9d38", "#fcbd5c"];
const green = ["#006502", "#1c851a", "#42a43e", "#63c45e", "#84e57d"];
const blue = ["#005591", "#0072bf", "#1590ec", "#5bb0ff", "#9fcfff"];
const violet = ["#74298f", "#9248af", "#b267d0", "#d286f2", "#e8b2ff"];
const magenta = ["#94104f", "#b6386b", "#d95888", "#fc78a6", "#ffb0c8"];
export const THEMES = [
  // Pale ceramic armour, red note and iris, amber studio lights.
  {
    id: "barchord",
    name: "BARCHORD I",
    eye: red,
    vest: neutral[4],
    trim: gold,
  },
  // The workers wear the same burgundy armour with different eye colours.
  {
    id: "barchord-iv",
    name: "BARCHORD IV",
    eye: orange,
    vest: red[0],
    trim: red,
  },
  { id: "barchord-v", name: "BARCHORD V", eye: gold, vest: red[0], trim: red },
  // Burnt-orange armour and a gold lion.
  {
    id: "bardon",
    name: "BARDON",
    eye: green,
    vest: orange[2],
    trim: orange,
    hardware: gold,
  },
  // Black armour, gold nameplate and orange lion.
  {
    id: "barney",
    name: "BARNEY",
    eye: blue,
    vest: neutral[0],
    trim: gold,
    hardware: orange,
  },
  // Berry-magenta armour with charcoal hardware and violet eyes.
  {
    id: "barbie",
    name: "BARBIE",
    eye: violet,
    vest: magenta[0],
    trim: magenta,
  },
  { id: "default", name: "Neutral", eye: neutral },
  { id: "system", name: "System", system: true },
];

const SURFACES = {
  default: {
    ground: neutral[0],
    surface: "#202020",
    raised: "#292929",
    line: "#353535",
    ink: neutral[4],
    muted: neutral[3],
    checker: ["#2a2a2a", "#212121"],
  },
  day: {
    ground: neutral[4],
    surface: "#f7f7f7",
    raised: "#ffffff",
    line: "#d7d7d7",
    ink: neutral[0],
    muted: neutral[1],
    checker: ["#e6e6e6", "#f1f1f1"],
  },
  night: {
    ground: "#101010",
    surface: "#171717",
    raised: "#212121",
    line: "#2c2c2c",
    ink: neutral[4],
    muted: neutral[3],
    checker: ["#202020", "#171717"],
  },
  contrast: {
    ground: "#000000",
    surface: "#000000",
    raised: "#000000",
    line: neutral[3],
    ink: "#ffffff",
    muted: neutral[4],
    checker: [neutral[0], "#000000"],
  },
};

export const MODIFIERS = [
  { id: "default", name: "Default" },
  { id: "day", name: "Day" },
  { id: "night", name: "Night" },
  { id: "contrast", name: "Contrast" },
];
export const DEFAULT_THEME = "barchord";

const NEUTRAL_THEME = "default";
const renamed = {
  graphite: NEUTRAL_THEME,
  lewd: "barchord-iv",
  lude: "barchord-iv",
  nord: "barney",
  everforest: "bardon",
};
const themeId = (id) => (Object.hasOwn(renamed, id) ? renamed[id] : id);
const themeById = (id) =>
  THEMES.find((theme) => theme.id === themeId(id)) || THEMES[0];

export function resolveTheme(id, modifier, system) {
  const theme = themeById(id);
  const osAccent = theme.system ? system?.accent : null;
  let look = Object.hasOwn(SURFACES, modifier) ? modifier : "default";
  if (look === "default" && theme.system && system?.dark === false)
    look = "day";
  const highContrast = look === "contrast";
  const dark = look !== "day";
  const eye = theme.eye || neutral;
  const shade = highContrast
    ? 4
    : look === "day"
      ? 0
      : look === "night"
        ? 3
        : 2;
  const base = SURFACES[look];
  const { ground, raised, line, ink, muted, checker } = base;
  const vest = theme.vest || base.surface;
  const surface = highContrast
    ? base.surface
    : mix(base.surface, vest, dark ? 0.07 : 0.04);
  const chrome = highContrast
    ? surface
    : mix(base.surface, vest, dark ? 0.19 : 0.12);
  const masthead = look === "default" ? "#232529" : surface;
  const main =
    osAccent && highContrast ? amplify(osAccent) : osAccent || eye[shade];
  const hover = highContrast ? "#262626" : mix(raised, main, 0.08);
  const panels = [ground, surface, raised, chrome, masthead, hover];
  // Filled controls and focus outlines stand out even with a subdued OS accent.
  const accent = readable(main, panels, 3);
  const onAccent =
    contrast(accent, "#000000") >= contrast(accent, "#ffffff")
      ? "#000000"
      : "#ffffff";
  const accentHover = readable(mix(accent, ink, 0.12), [onAccent], 4.5);
  const accentSoft = highContrast
    ? neutral[0]
    : mix(surface, accent, dark ? 0.18 : 0.11);
  const textSurfaces = [...panels, accentSoft];
  const trim = theme.trim?.[dark ? 3 : 0] || main;
  const focus = (theme.hardware || eye)[dark ? 4 : 0];
  const wordmark = dark ? neutral[4] : neutral[0];
  return {
    dark,
    contrast: highContrast,
    tokens: {
      "--ground": ground,
      "--surface": surface,
      "--chrome": chrome,
      "--masthead": masthead,
      "--wordmark": wordmark,
      "--maker-credit": readable(dark ? neutral[3] : neutral[1], [masthead], 4.5),
      "--maker-wordmark": wordmark,
      "--raised": raised,
      "--hover": hover,
      "--line": line,
      "--line-strong": highContrast ? ink : mix(line, ink, 0.16),
      "--field-line": highContrast ? ink : readable(line, [raised, hover], 3),
      "--ink": readable(ink, textSurfaces, 7),
      "--muted": readable(muted, textSurfaces, 4.5),
      "--accent": accent,
      "--accent-hover": accentHover,
      "--on-accent": onAccent,
      "--accent-text": readable(main, textSurfaces, 4.5),
      "--accent-soft": accentSoft,
      "--trim": readable(trim, textSurfaces, 4.5),
      "--focus": readable(focus, textSurfaces, 3),
      "--warn": readable(gold[dark ? 4 : 0], textSurfaces, 4.5),
      "--checker1": checker[0],
      "--checker2": checker[1],
      "--shadow": dark ? "0 2px 12px #00000073" : "0 2px 10px #0000001f",
    },
  };
}

// The stored setting is "modifier:theme". Keep the modifier when migrating
// earlier theme names and keep the original neutral choice for bare modes.
export function parseThemeSetting(value) {
  const [first = "", second = ""] = String(value || "").split(":");
  const oldMode =
    first === "dark" ? "default" : first === "light" ? "day" : null;
  const modifier = MODIFIERS.some((m) => m.id === first) ? first : oldMode;
  if (second === "contrast")
    return { modifier: "contrast", theme: NEUTRAL_THEME, saved: true };
  const savedTheme = themeId(second);
  return {
    modifier,
    theme: THEMES.some(({ id }) => id === savedTheme)
      ? savedTheme
      : value
        ? NEUTRAL_THEME
        : DEFAULT_THEME,
    saved: !!value,
  };
}
