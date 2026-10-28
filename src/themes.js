// Colour themes for the interface. Each has a dark and a light version, given
// as a few base colours; the rest (hover, borders, readable text on buttons)
// is worked out here, and every text colour is nudged until it reads at WCAG AA
// (4.5:1) on every surface it sits on, so any theme passes the same checks.
// The colourful palettes follow well-known open-source editor themes (all MIT;
// see THIRD_PARTY_NOTICES.md).

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

// id, name, and per mode: ground (around the canvas), surface (bars, panels),
// raised (fields, chips), line, ink (text), muted, accent, focus, and the
// darkest/lightest ink to put on accent fills.
export const THEMES = [
  {
    id: "graphite",
    name: "Graphite",
    dark: {
      ground: "#141414",
      surface: "#1c1c1c",
      raised: "#262626",
      line: "#303030",
      ink: "#ececec",
      muted: "#a3a3a3",
      accent: "#e6e6e6",
      focus: "#ffffff",
    },
    light: {
      ground: "#e9e9e9",
      surface: "#f6f6f6",
      raised: "#ffffff",
      line: "#d9d9d9",
      ink: "#171717",
      muted: "#595959",
      accent: "#1f1f1f",
      focus: "#000000",
    },
  },
  {
    id: "contrast",
    name: "High contrast",
    contrast: true,
    dark: {
      ground: "#000000",
      surface: "#000000",
      raised: "#000000",
      line: "#ffffff",
      ink: "#ffffff",
      muted: "#e6e6e6",
      accent: "#ffe600",
      focus: "#00e5ff",
      warn: "#ffb000",
    },
    light: {
      ground: "#ffffff",
      surface: "#ffffff",
      raised: "#ffffff",
      line: "#000000",
      ink: "#000000",
      muted: "#1a1a1a",
      accent: "#0000c8",
      focus: "#c00000",
      warn: "#7a3d00",
    },
  },
  {
    id: "lewd",
    name: "Lewd",
    dark: {
      ground: "#141414",
      surface: "#1c1c1c",
      raised: "#262626",
      line: "#303030",
      ink: "#ececec",
      muted: "#a3a3a3",
      accent: "#e8802e",
      focus: "#6ef0ff",
    },
    light: {
      ground: "#e9e9e9",
      surface: "#f6f6f6",
      raised: "#ffffff",
      line: "#d9d9d9",
      ink: "#171717",
      muted: "#595959",
      accent: "#e8802e",
      focus: "#007c99",
    },
  },
  {
    id: "nord",
    name: "Nord",
    dark: {
      ground: "#2e3440",
      surface: "#3b4252",
      raised: "#434c5e",
      line: "#4c566a",
      ink: "#eceff4",
      muted: "#d8dee9",
      accent: "#88c0d0",
      focus: "#ebcb8b",
    },
    light: {
      ground: "#d8dee9",
      surface: "#e5e9f0",
      raised: "#eceff4",
      line: "#c2cad6",
      ink: "#2e3440",
      muted: "#4c566a",
      accent: "#5e81ac",
      focus: "#bf616a",
    },
  },
  {
    id: "solarized",
    name: "Solarized",
    dark: {
      ground: "#002b36",
      surface: "#073642",
      raised: "#0b4251",
      line: "#24525e",
      ink: "#eee8d5",
      muted: "#93a1a1",
      accent: "#268bd2",
      focus: "#b58900",
    },
    light: {
      ground: "#eee8d5",
      surface: "#fdf6e3",
      raised: "#fffdf7",
      line: "#dcd4bc",
      ink: "#073642",
      muted: "#586e75",
      accent: "#268bd2",
      focus: "#cb4b16",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: {
      ground: "#21222c",
      surface: "#282a36",
      raised: "#343746",
      line: "#44475a",
      ink: "#f8f8f2",
      muted: "#b6bcdc",
      accent: "#ff79c6",
      focus: "#8be9fd",
    },
    light: {
      ground: "#f2ecd8",
      surface: "#fffbeb",
      raised: "#ffffff",
      line: "#ddd6c1",
      ink: "#1f1f1f",
      muted: "#5d5880",
      accent: "#a3144d",
      focus: "#036a96",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    dark: {
      ground: "#181825",
      surface: "#1e1e2e",
      raised: "#313244",
      line: "#45475a",
      ink: "#cdd6f4",
      muted: "#a6adc8",
      accent: "#cba6f7",
      focus: "#89dceb",
    },
    light: {
      ground: "#e6e9ef",
      surface: "#eff1f5",
      raised: "#ffffff",
      line: "#ccd0da",
      ink: "#4c4f69",
      muted: "#6c6f85",
      accent: "#8839ef",
      focus: "#04a5e5",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    dark: {
      ground: "#1d2021",
      surface: "#282828",
      raised: "#3c3836",
      line: "#504945",
      ink: "#ebdbb2",
      muted: "#a89984",
      accent: "#fabd2f",
      focus: "#83a598",
    },
    light: {
      ground: "#f2e5bc",
      surface: "#fbf1c7",
      raised: "#fffbe8",
      line: "#d5c4a1",
      ink: "#3c3836",
      muted: "#665c54",
      accent: "#b57614",
      focus: "#076678",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    dark: {
      ground: "#191724",
      surface: "#1f1d2e",
      raised: "#26233a",
      line: "#403d52",
      ink: "#e0def4",
      muted: "#908caa",
      accent: "#ebbcba",
      focus: "#9ccfd8",
    },
    light: {
      ground: "#f2e9e1",
      surface: "#faf4ed",
      raised: "#fffaf3",
      line: "#dfdad9",
      ink: "#575279",
      muted: "#797593",
      accent: "#d7827e",
      focus: "#286983",
    },
  },
  {
    id: "everforest",
    name: "Everforest",
    dark: {
      ground: "#272e33",
      surface: "#2d353b",
      raised: "#343f44",
      line: "#475258",
      ink: "#d3c6aa",
      muted: "#9da9a0",
      accent: "#a7c080",
      focus: "#e69875",
    },
    light: {
      ground: "#efebd4",
      surface: "#fdf6e3",
      raised: "#fffbef",
      line: "#e0dcc7",
      ink: "#5c6a72",
      muted: "#707f74",
      accent: "#8da101",
      focus: "#3a94c5",
    },
  },
];
export const DEFAULT_THEME = "graphite";
export const themeById = (id) =>
  THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

// Every CSS custom property the stylesheet reads, for one theme in one mode.
export function themeTokens(id, mode) {
  const theme = themeById(id),
    p = theme[mode],
    dark = mode === "dark",
    { ground, surface, raised, line, ink } = p,
    panels = [ground, surface, raised];
  // Text on an accent fill: whichever of near-black and white reads better;
  // the fill darkens or lightens a little if neither reaches 4.5:1.
  const darkInk = mix(dark ? ground : ink, "#000000", 0.5),
    onAccent =
      contrast(p.accent, darkInk) >= contrast(p.accent, "#ffffff")
        ? darkInk
        : "#ffffff",
    accent = readable(p.accent, [onAccent], 4.5),
    accentSoft = mix(surface, accent, dark ? 0.18 : 0.14);
  return {
    "--ground": ground,
    "--surface": surface,
    "--raised": raised,
    "--hover": mix(raised, ink, theme.contrast ? 0.18 : 0.07),
    "--line": line,
    "--line-strong": theme.contrast ? ink : mix(line, ink, 0.14),
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
    "--checker1": mix(ground, ink, dark ? 0.07 : 0.06),
    "--checker2": mix(ground, ink, dark ? 0.02 : 0.015),
    "--shadow": dark ? "0 2px 12px #00000073" : "0 2px 10px #0000001f",
  };
}
