// This origin can host other projects: never touch their requests or caches.
const PREFIX = "hexshift-shell-",
  CACHE = PREFIX + "703a3c60148de5de",
  LEGACY = "hexshift-v1";
const ROOT = new URL("./", self.location.href),
  INDEX = new URL("index.html", ROOT).href,
  PORTABLE_PAGES = ["Barhex.html", "HexShift.html"].map(
    (path) => new URL(path, ROOT).href,
  ),
  SHELL = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-512-maskable.png",
    "./icons/apple-touch-icon.png",
  ].map((p) => new URL(p, ROOT).href);
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
// Do not skip waiting: a session keeps its version until all its tabs close.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith(PREFIX) || key === LEGACY) && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  url.hash = "";
  if (url.origin !== ROOT.origin || url.search) return;
  const portablePage =
    e.request.mode === "navigate" && PORTABLE_PAGES.includes(url.href);
  if (!portablePage && !SHELL.includes(url.href)) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        hit = await cache.match(portablePage ? INDEX : e.request);
      // An immutable version of the HTML must stay paired with its controlling worker.
      if (hit) return hit;
      try {
        const response = await fetch(e.request);
        const expected = url.pathname.endsWith(".js")
          ? "javascript"
          : url.pathname.endsWith(".png")
            ? "image/png"
            : url.pathname.endsWith(".webmanifest")
              ? "manifest+json"
              : "text/html";
        if (
          response.ok &&
          response.type === "basic" &&
          !response.redirected &&
          (response.headers.get("content-type") || "").includes(expected)
        )
          await cache.put(portablePage ? INDEX : e.request, response.clone());
        return response;
      } catch {
        if (e.request.mode === "navigate") {
          const fallback = await cache.match(INDEX);
          if (fallback) return fallback;
        }
        return Response.error();
      }
    })(),
  );
});
