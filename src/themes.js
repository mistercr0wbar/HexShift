// Colour themes for the interface. A theme is picked together with a modifier:
// Default (the theme's own look), Day (light), Night (deeper and darker) and
// Contrast (pitch black, with the theme's main colour boosted as the accent).
// Each look is given as a few base colours; the rest (hover, borders, readable
// text on buttons) is worked out here, and every text colour is nudged until it
// reads at WCAG AA on every surface it sits on, so every look passes the same
// checks. System builds its looks from the colours the operating system
// reports (in the Windows app: the accent colour and the light/dark app mode).
// Nord and Everforest follow their open-source palettes (both MIT; see
// THIRD_PARTY_NOTICES.md).

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
export function amplify(colour) {
  const [h, s] = toHsl(colour);
  if (s < 0.12) return "#ffffff";
  const sat = Math.min(1, s * 1.4 + 0.25);
  for (let l = 0.5; l <= 0.9; l += 0.01) {
    const c = fromHsl(h, sat, l);
    if (contrast(c, "#000000") >= 8) return c;
  }
  return fromHsl(h, sat, 0.9);
}

const DEFAULT_LOOKS = {
  default: {
    ground: "#141414",
    surface: "#1c1c1c",
    raised: "#262626",
    line: "#303030",
    ink: "#ececec",
    muted: "#a3a3a3",
    accent: "#e6e6e6",
    focus: "#ffffff",
  },
  day: {
    ground: "#e9e9e9",
    surface: "#f6f6f6",
    raised: "#ffffff",
    line: "#d9d9d9",
    ink: "#171717",
    muted: "#595959",
    accent: "#1f1f1f",
    focus: "#000000",
  },
  night: {
    ground: "#080808",
    surface: "#0f0f0f",
    raised: "#181818",
    line: "#242424",
    ink: "#e8e8e8",
    muted: "#9c9c9c",
    accent: "#e0e0e0",
    focus: "#ffffff",
  },
};
const withAccent = (look, accent, focus) => ({ ...look, accent, focus });

// id, name, and per look: ground (around the canvas), surface (bars, panels),
// raised (fields, chips), line, ink (text), muted, accent and focus. The
// Default look's accent is the theme's main colour, which Contrast boosts.
export const THEMES = [
  { id: "default", name: "Default", ...DEFAULT_LOOKS },
  {
    id: "lude",
    name: "Lude",
    default: withAccent(DEFAULT_LOOKS.default, "#e8802e", "#6ef0ff"),
    day: withAccent(DEFAULT_LOOKS.day, "#e8802e", "#007c99"),
    night: withAccent(DEFAULT_LOOKS.night, "#e8802e", "#6ef0ff"),
  },
  {
    id: "nord",
    name: "Nord",
    default: {
      ground: "#2e3440",
      surface: "#3b4252",
      raised: "#434c5e",
      line: "#4c566a",
      ink: "#eceff4",
      muted: "#d8dee9",
      accent: "#88c0d0",
      focus: "#ebcb8b",
    },
    day: {
      ground: "#d8dee9",
      surface: "#e5e9f0",
      raised: "#eceff4",
      line: "#c2cad6",
      ink: "#2e3440",
      muted: "#4c566a",
      accent: "#5e81ac",
      focus: "#bf616a",
    },
    night: {
      ground: "#1b1f27",
      surface: "#21262f",
      raised: "#2a303b",
      line: "#3b4252",
      ink: "#eceff4",
      muted: "#c2cad6",
      accent: "#88c0d0",
      focus: "#ebcb8b",
    },
  },
  {
    id: "everforest",
    name: "Everforest",
    default: {
      ground: "#272e33",
      surface: "#2d353b",
      raised: "#343f44",
      line: "#475258",
      ink: "#d3c6aa",
      muted: "#9da9a0",
      accent: "#a7c080",
      focus: "#e69875",
    },
    day: {
      ground: "#efebd4",
      surface: "#fdf6e3",
      raised: "#fffbef",
      line: "#e0dcc7",
      ink: "#5c6a72",
      muted: "#707f74",
      accent: "#8da101",
      focus: "#3a94c5",
    },
    night: {
      ground: "#1a1f22",
      surface: "#1e2326",
      raised: "#272e33",
      line: "#374145",
      ink: "#d3c6aa",
      muted: "#9da9a0",
      accent: "#a7c080",
      focus: "#e69875",
    },
  },
  // Follows the operating system; its looks are built in systemLooks().
  { id: "system", name: "System", system: true },
];
export const MODIFIERS = [
  { id: "default", name: "Default" },
  { id: "day", name: "Day" },
  { id: "night", name: "Night" },
  { id: "contrast", name: "Contrast" },
];
export const DEFAULT_THEME = "default";
export const themeById = (id) =>
  THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

// System: the OS accent on neutral surfaces. Its Default look follows the
// OS light/dark setting; without a known accent it looks like Default.
function systemLooks({ accent, dark } = {}) {
  const pick = (look) => (accent ? withAccent(look, accent, look.focus) : look);
  return {
    default: pick(dark === false ? DEFAULT_LOOKS.day : DEFAULT_LOOKS.default),
    day: pick(DEFAULT_LOOKS.day),
    night: pick(DEFAULT_LOOKS.night),
  };
}
// System keeps the OS accent as it is, only brightened enough to read on
// black; the other themes boost their main colour.
const contrastLook = (main, boost) => {
  const accent = boost ? amplify(main) : readable(main, ["#000000"], 8);
  return {
    ground: "#000000",
    surface: "#000000",
    raised: "#000000",
    line: "#9a9a9a",
    ink: "#ffffff",
    muted: "#e0e0e0",
    accent,
    focus: accent === "#ffffff" ? "#ffd400" : "#ffffff",
    warn: "#ffb000",
    contrast: true,
  };
};

// The look for a theme and modifier: { dark, contrast, tokens }, where tokens
// are every CSS custom property the stylesheet reads. `system` is the OS's
// { accent, dark } for the System theme.
export function resolveTheme(id, modifier, system) {
  const theme = themeById(id),
    looks = theme.system ? systemLooks(system) : theme,
    p =
      modifier === "contrast"
        ? contrastLook(looks.default.accent, !theme.system)
        : looks[
            MODIFIERS.some((m) => m.id === modifier) ? modifier : "default"
          ],
    dark = luminance(p.ground) < 0.2,
    { ground, surface, raised, line, ink } = p,
    panels = [ground, surface, raised];
  // Accent fills stand out from the panels (3:1, so a selected choice shows
  // even with a dark OS accent on a dark theme). Text on them is whichever of
  // near-black and white reads better; the fill shifts a little if neither
  // reaches 4.5:1.
  const fill = readable(p.accent, panels, 3),
    darkInk = mix(dark ? ground : ink, "#000000", 0.5),
    onAccent =
      contrast(fill, darkInk) >= contrast(fill, "#ffffff")
        ? darkInk
        : "#ffffff",
    accent = readable(fill, [onAccent], 4.5),
    accentSoft = p.contrast
      ? "#1a1a1a"
      : mix(surface, accent, dark ? 0.18 : 0.14);
  return {
    dark,
    contrast: !!p.contrast,
    tokens: {
      "--ground": ground,
      "--surface": surface,
      "--raised": raised,
      "--hover": p.contrast ? "#262626" : mix(raised, ink, 0.07),
      "--line": line,
      "--line-strong": p.contrast ? ink : mix(line, ink, 0.14),
      "--ink": readable(ink, [...panels, accentSoft], 7),
      "--muted": readable(p.muted, panels, 4.5),
      "--accent": accent,
      "--on-accent": onAccent,
      "--accent-text": readable(p.accent, [...panels, accentSoft], 4.5),
      "--accent-soft": accentSoft,
      "--focus": readable(p.focus, panels, 3),
      "--warn": readable(
        p.warn || (dark ? "#f0b54a" : "#855000"),
        [...panels, accentSoft],
        4.5,
      ),
      "--checker1": p.contrast
        ? "#1a1a1a"
        : mix(ground, ink, dark ? 0.07 : 0.06),
      "--checker2": p.contrast
        ? "#000000"
        : mix(ground, ink, dark ? 0.02 : 0.015),
      "--shadow": dark ? "0 2px 12px #00000073" : "0 2px 10px #0000001f",
    },
  };
}
// The stored setting is "modifier:theme". Values from 3.0 ("dark:nord") and
// earlier ("dark") are read as the nearest new look.
export function parseThemeSetting(value) {
  const [first = "", second = ""] = String(value || "").split(":"),
    renamed = { graphite: "default", lewd: "lude" },
    oldMode = { dark: "default", light: "day" };
  let modifier = MODIFIERS.some((m) => m.id === first)
      ? first
      : oldMode[first] || null,
    theme = renamed[second] || second;
  if (theme === "contrast") [theme, modifier] = ["default", "contrast"];
  if (!THEMES.some((t) => t.id === theme)) theme = DEFAULT_THEME;
  return { modifier, theme, saved: !!value };
}
