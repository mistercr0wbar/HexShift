// What the page can ask of the app around it. The Windows app (WebView2) has its
// own screen picker, because WebView2 cancels the browser's EyeDropper before it
// opens; browsers with EyeDropper use that; elsewhere there is none. An Android
// host can slot in here without the editor changing.

// The colours the System theme follows, as { accent: "#rrggbb" | null, dark }.
// The Windows app sends its accent and app mode (and sends them again when
// they change); browsers report light or dark, and the accent through CSS's
// AccentColor where they support it. onChange gets every update.
export function systemColours(onChange) {
  const scheme = matchMedia("(prefers-color-scheme: dark)"),
    webview = window.chrome?.webview;
  if (webview)
    webview.addEventListener("message", (e) => {
      const d = e.data;
      if (
        d?.type === "system-colours" &&
        (d.accent === null || /^#[0-9a-f]{6}$/i.test(d.accent)) &&
        typeof d.dark === "boolean"
      )
        onChange({ accent: d.accent?.toLowerCase() ?? null, dark: d.dark });
    });
  else
    scheme.addEventListener("change", () =>
      onChange({ accent: cssAccent(), dark: scheme.matches }),
    );
  return { accent: cssAccent(), dark: scheme.matches };
}
function cssAccent() {
  if (!CSS.supports("color", "AccentColor")) return null;
  const probe = document.createElement("i");
  probe.style.color = "AccentColor";
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+/g);
  probe.remove();
  return rgb
    ? "#" +
        rgb
          .slice(0, 3)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("")
    : null;
}

// The Windows app checks for updates at every launch and tells the page how it went;
// the page can ask for a check by hand and switch the automatic ones on or off.
// Returns null outside the app (a browser updates itself). Every message is
// checked field by field before onState hears it. The words the page may send
// are exactly these three and "update-state" (a request for the latest state).
const PHASES = [
  "idle",
  "checking",
  "current",
  "available",
  "downloading",
  "ready",
  "failed",
];
export function updateChannel(onState) {
  const webview = window.chrome?.webview;
  if (!webview) return null;
  webview.addEventListener("message", (e) => {
    const d = e.data;
    if (d?.type !== "update-state" || !PHASES.includes(d.phase)) return;
    onState({
      phase: d.phase,
      version:
        typeof d.version === "string" &&
        /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(d.version)
          ? d.version
          : null,
      checkedAt: typeof d.checkedAt === "string" ? d.checkedAt : null,
      auto: typeof d.auto === "boolean" ? d.auto : true,
      enabled: typeof d.enabled === "boolean" ? d.enabled : true,
      manual: d.manual === true,
      detail: typeof d.detail === "string" ? d.detail.slice(0, 300) : null,
      percent: Number.isFinite(d.percent) ? d.percent : 0,
    });
  });
  return {
    check: () => webview.postMessage("check-updates"),
    setAuto: (on) =>
      webview.postMessage(on ? "auto-updates-on" : "auto-updates-off"),
    request: () => webview.postMessage("update-state"),
  };
}

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
