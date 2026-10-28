// Images live only in this session. History has one budget across the workspace;
// discard the oldest background undo first, keeping the active tab useful longest.
export const MAX_DOCUMENTS = 20;
export const HISTORY_BYTES = 96 * 1024 * 1024;

export function trimHistories(documents, active, maxBytes = HISTORY_BYTES) {
  let bytes = documents.reduce((sum, doc) => sum + doc.history.bytes, 0);
  const order = [
    ...documents.filter((doc) => doc !== active),
    ...(active ? [active] : []),
  ];
  for (const doc of order) {
    while (bytes > maxBytes && doc.history.bytes) {
      const removed = doc.history.trimOldest();
      if (!removed) break;
      bytes -= removed;
    }
    if (bytes <= maxBytes) break;
  }
  return bytes;
}

export function selectDocuments(documents, selected, anchor, target, range) {
  if (range && anchor && documents.includes(anchor)) {
    const a = documents.indexOf(anchor),
      b = documents.indexOf(target);
    return new Set(documents.slice(Math.min(a, b), Math.max(a, b) + 1));
  }
  const next = new Set(selected);
  if (next.has(target)) next.delete(target);
  else next.add(target);
  return next;
}
