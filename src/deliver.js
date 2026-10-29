import { encode } from "./export.js";
import { finish, fit } from "./output.js";
import { outputsFor } from "./presets.js";
// The whole export: outline, then trim and padding, then each output's fit
// and encoding. Variants, batches and the size readout call this too.
// `format` overrides every output's format (copying is always PNG); `first`
// stops after the first output. Smooth scaling is the default.
export async function deliver(
  pixels,
  w,
  h,
  settings,
  yieldFn,
  { first = false, format } = {},
) {
  const done = await finish(pixels, w, h, settings, yieldFn),
    scale = settings.scale === "nearest" ? "nearest" : "smooth",
    outputs = outputsFor(settings.size, done.width, done.height, settings),
    files = [];
  for (const o of first ? outputs.slice(0, 1) : outputs) {
    const image = o.box
      ? fit(done.pixels, done.width, done.height, o.box, o.pad, scale)
      : done;
    await yieldFn?.();
    files.push({
      ...o,
      format: format || o.format,
      blob: await encode(
        image.pixels,
        image.width,
        image.height,
        format || o.format,
        o.limit,
      ),
    });
  }
  return files;
}
