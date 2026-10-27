// Yield to the event loop at most once per time budget. Nested setTimeout(0)
// calls are clamped to at least 4 ms each, which used to add seconds of idle
// time per pass on large images. A MessageChannel round trip is not clamped.
export function makePause(budget = 12) {
  let last = 0;
  return () => {
    if (performance.now() - last < budget) return;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        last = performance.now();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  };
}
