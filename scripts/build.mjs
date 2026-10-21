import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const hash = (s) => createHash("sha256").update(s).digest("base64");
const readText = async (path) =>
  (await readFile(path, "utf8")).replace(/\r\n?/g, "\n");
const worker = (
  await build({
    entryPoints: ["src/worker.js"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    minify: true,
  })
).outputFiles[0].text;
const js = (
  await build({
    entryPoints: ["src/app.js"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    define: { __WORKER__: JSON.stringify(worker) },
    // Full, unmodified licence notices are embedded in the HTML template below.
    legalComments: "none",
  })
).outputFiles[0].text;
const css = await readText("src/style.css"),
  icon =
    "data:image/png;base64," +
    (await readFile("icons/icon-192.png")).toString("base64");
const policy = `default-src 'none'; script-src 'sha256-${hash(js)}'; style-src 'sha256-${hash(css)}'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'`;
const notices = (await readText("THIRD_PARTY_NOTICES.md"))
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  // Preserve upstream licence whitespace in parsed text without trailing spaces
  // in the generated source.
  .replace(/[ \t]+(?=\n)/g, (spaces) =>
    [...spaces].map((c) => (c === "\t" ? "&#9;" : "&#32;")).join(""),
  );
const html = (await readText("src/index.html"))
  .replace("__CSP__", policy)
  .replace("__ICON__", icon)
  .replace(/<style>\s*__CSS__\s*<\/style>/, () => "<style>" + css + "</style>")
  .replace(
    /<script>\s*__SCRIPT__;?\s*<\/script>/,
    () => "<script>" + js + "</script>",
  )
  .replace("__NOTICES__", () => notices);
await writeFile("HexShift.html", html);
const versionHash = createHash("sha256")
  .update(html)
  .update(await readText("manifest.webmanifest"))
  .update(await readText("src/sw.js"));
for (const iconPath of [
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png",
])
  versionHash.update(await readFile("icons/" + iconPath));
const version = versionHash.digest("hex").slice(0, 16);
await writeFile(
  "sw.js",
  (await readText("src/sw.js")).replace("__VERSION__", version),
);
await mkdir("dist", { recursive: true });
console.log(
  `Built portable HTML (${Math.round(Buffer.byteLength(html) / 1024)} KiB), shell ${version}.`,
);
