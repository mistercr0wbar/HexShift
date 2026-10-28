// What the page can ask of the app around it. The Windows app (WebView2) has its
// own screen picker, because WebView2 cancels the browser's EyeDropper before it
// opens; browsers with EyeDropper use that; elsewhere there is none. An Android
// host can slot in here without the editor changing.

// Returns a function that starts a screen pick, or null when picking from the
// screen isn't possible. onPicked gets "#RRGGBB", or null when nothing was
// picked; onError gets an unexpected failure.
export function screenPicker(onPicked, onError) {
  const webview = window.chrome?.webview;
  if (webview) {
    // Every reply counts, even one that arrives without a pending pick: the
    // host only ever sends this one message type.
    webview.addEventListener("message", (e) => {
      if (e.data?.type === "picked-colour") onPicked(e.data.hex);
    });
    return () => webview.postMessage("pick-colour");
  }
  if ("EyeDropper" in window)
    return async () => {
      try {
        onPicked((await new window.EyeDropper().open()).sRGBHex);
      } catch (e) {
        if (e.name === "AbortError") onPicked(null);
        else onError(e);
      }
    };
  return null;
}
