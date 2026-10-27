// Upload sizes and limits for chat platforms (checked 26 Oct 2026; see
// docs/research.md). `box` is the longest side; `pad` makes it an exact
// square with the artwork centred. Several outputs are saved as one ZIP.
const KB = 1024;
export const PRESETS = [
  { id: "original", label: "Original size" },
  {
    id: "discord-emoji",
    label: "Discord emoji · 128 px",
    outputs: [{ box: 128, pad: true, limit: 256 * KB }],
  },
  {
    id: "discord-sticker",
    label: "Discord sticker · 320 px",
    outputs: [{ box: 320, pad: true, limit: 512 * KB }],
  },
  {
    id: "slack-emoji",
    label: "Slack emoji · 128 px",
    outputs: [{ box: 128, pad: true, limit: 128 * KB }],
  },
  {
    id: "twitch-emotes",
    label: "Twitch emotes · 112, 56, 28 px",
    outputs: [112, 56, 28].map((box) => ({
      box,
      pad: true,
      limit: 1024 * KB,
      suffix: box + "px",
      format: "png",
    })),
  },
  {
    id: "telegram-sticker",
    label: "Telegram sticker · 512 px",
    outputs: [{ box: 512, limit: 512 * KB }],
    formats: ["png", "webp", "webp-small"],
  },
  {
    id: "telegram-emoji",
    label: "Telegram emoji · 100 px",
    outputs: [{ box: 100, pad: true, limit: 256 * KB }],
    formats: ["png", "webp"],
  },
  {
    id: "whatsapp-sticker",
    label: "WhatsApp sticker · 512 px + tray",
    outputs: [
      {
        box: 512,
        pad: true,
        limit: 100 * KB,
        suffix: "sticker",
        format: "webp-small",
      },
      { box: 96, pad: true, limit: 50 * KB, suffix: "tray", format: "png" },
    ],
  },
  {
    id: "youtube-emoji",
    label: "YouTube emoji · 48 px",
    outputs: [{ box: 48, pad: true, limit: 1024 * KB }],
  },
  { id: "custom", label: "Custom size" },
];
export const FORMATS = ["png", "webp", "webp-small"];
export const CUSTOM_MIN = 16,
  CUSTOM_MAX = 2048;
export const presetById = (id) =>
  PRESETS.find((p) => p.id === id) || PRESETS[0];
// The formats the export format select may offer for a preset. A preset whose
// outputs fix their own formats (a pack) offers none.
export function formatsFor(preset) {
  if (preset.outputs?.every((o) => o.format)) return [];
  return preset.formats || (preset.outputs ? ["png"] : FORMATS);
}
// The files an export makes from a finished image of w × h pixels.
export function outputsFor(id, w, h, { format = "png", custom = 512 } = {}) {
  const preset = presetById(id),
    allowed = formatsFor(preset),
    chosen = allowed.includes(format) ? format : allowed[0];
  if (id === "custom") {
    const box = Number.isFinite(custom)
      ? Math.round(Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, custom)))
      : 512;
    return [
      { box, format: chosen, suffix: box + "px", ...fitted(w, h, box, false) },
    ];
  }
  if (!preset.outputs)
    return [{ format: chosen, width: w, height: h, enlarged: false }];
  return preset.outputs.map((o) => ({
    ...o,
    suffix: o.suffix || preset.id,
    format: o.format || chosen,
    ...fitted(w, h, o.box, o.pad),
  }));
}
// Output dimensions when w × h is fitted into a box (and padded to a square).
export function fitted(w, h, box, pad) {
  const scale = box / Math.max(w, h);
  return {
    width: pad ? box : Math.max(1, Math.round(w * scale)),
    height: pad ? box : Math.max(1, Math.round(h * scale)),
    enlarged: scale > 1,
  };
}
