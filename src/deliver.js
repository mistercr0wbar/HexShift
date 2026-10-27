import { encode } from "./export.js";
import { finish, fit } from "./output.js";
import { outputsFor } from "./presets.js";
// The whole export: the outline, then each output's fit and encoding. The size
// readout runs this too, so the sizes it shows are the files you save.
// `format` overrides every output's format (copying is always PNG); `first`
// stops after the first output.
export async function deliver(
  pixels,
  w,
  h,
  settings,
  yieldFn,
  { first = false, format } = {},
) {
  const done = await finish(pixels, w, h, settings, yieldFn),
    outputs = outputsFor(settings.size, done.width, done.height, settings),
    files = [];
  for (const o of first ? outputs.slice(0, 1) : outputs) {
    const image = o.box
      ? fit(done.pixels, done.width, done.height, o.box, o.pad)
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
