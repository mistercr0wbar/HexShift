import { prepare, processEdit } from "./engine.js";
import { makePause } from "./yield.js";
let image = null,
  currentKey = null,
  sequence = 0;
const pause = makePause();
const preparedImages = new Map();
self.onmessage = async ({ data: m }) => {
  if (m.type === "release") {
    for (const key of preparedImages.keys())
      if (key.startsWith(m.documentId + ":")) preparedImages.delete(key);
    if (currentKey?.startsWith(m.documentId + ":")) {
      sequence++;
      image = null;
      currentKey = null;
    }
    return;
  }
  const ticket = ++sequence;
  try {
    if (!Number.isSafeInteger(m.imageId) || !Number.isSafeInteger(m.editId))
      throw Error("Invalid request identifiers.");
    if (m.type === "cancel") return;
    if (m.type === "image") {
      image = null;
      currentKey = m.cacheKey;
      let next = preparedImages.get(m.cacheKey);
      if (!next)
        next = await prepare(
          m.width,
          m.height,
          m.pixels,
          pause,
          () => ticket !== sequence,
        );
      if (ticket !== sequence) return;
      if (typeof m.cacheKey === "string") {
        const prefix = m.cacheKey.split(":")[0] + ":";
        for (const key of preparedImages.keys())
          if (key.startsWith(prefix)) preparedImages.delete(key);
        preparedImages.delete(m.cacheKey);
        preparedImages.set(m.cacheKey, next);
        while (preparedImages.size > 3)
          preparedImages.delete(preparedImages.keys().next().value);
      }
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
    const result = await processEdit(
      image,
      m.rows,
      m.overrides,
      m.active,
      pause,
      () => ticket !== sequence,
    );
    if (ticket === sequence)
      self.postMessage(
        { type: "result", imageId: m.imageId, editId: m.editId, ...result },
        [result.pixels.buffer, result.mask.buffer, result.owner.buffer],
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
