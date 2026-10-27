import { prepare, processImage } from "./engine.js";
import { makePause } from "./yield.js";
let image = null,
  sequence = 0;
const pause = makePause();
self.onmessage = async ({ data: m }) => {
  const ticket = ++sequence;
  try {
    if (!Number.isSafeInteger(m.imageId) || !Number.isSafeInteger(m.editId))
      throw Error("Invalid request identifiers.");
    if (m.type === "cancel") return;
    if (m.type === "image") {
      image = null;
      const next = await prepare(
        m.width,
        m.height,
        m.pixels,
        pause,
        () => ticket !== sequence,
      );
      if (ticket !== sequence) return;
      image = { ...next, id: m.imageId };
      self.postMessage({
        type: "ready",
        imageId: m.imageId,
        editId: m.editId,
        palette: image.palette,
      });
      return;
    }
    if (m.type !== "edit" || !image || image.id !== m.imageId)
      throw Error("Unknown image or operation.");
    const result = await processImage(
      image,
      m.params,
      m.seeds,
      m.overrides,
      pause,
      () => ticket !== sequence,
    );
    if (ticket === sequence)
      self.postMessage(
        { type: "result", imageId: m.imageId, editId: m.editId, ...result },
        [result.pixels.buffer, result.mask.buffer],
      );
  } catch (e) {
    if (ticket === sequence)
      self.postMessage({
        type: "error",
        imageId: m.imageId,
        editId: m.editId,
        message: e.message,
      });
  }
};
