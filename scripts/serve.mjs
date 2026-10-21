import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("."),
  types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
  };
const allowed = new Set([
  "/",
  "/index.html",
  "/HexShift.html",
  "/sw.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
]);
http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!allowed.has(path)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const file = resolve(
        root,
        path === "/" || path === "/index.html" ? "HexShift.html" : "." + path,
      );
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("HexShift: http://127.0.0.1:4173"),
  );
