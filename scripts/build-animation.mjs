import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const hash = (s) => createHash("sha256").update(s).digest("base64");
const dec = (await readFile("node_modules/@jsquash/webp/codec/dec/webp_dec.wasm")).toString("base64");
const enc = (await readFile("node_modules/@jsquash/webp/codec/enc/webp_enc.wasm")).toString("base64");
const notice = await readFile("node_modules/@jsquash/webp/codec/LICENSE.codec.md", "utf8");
const js = (
  await build({
    entryPoints: ["src/anim/page.js"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    legalComments: "none",
    define: {
      __WEBP_DEC_B64__: JSON.stringify(dec),
      __WEBP_ENC_B64__: JSON.stringify(enc),
    },
  })
).outputFiles[0].text;
const escaped = notice
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="data:,">
<title>Hex Shift animation prototype</title>
<style>body{font:16px/1.4 sans-serif;margin:24px;max-width:42rem}button{font:inherit}</style>
</head>
<body>
<h1>Hex Shift animation prototype</h1>
<p>This page is not the editor. Still images open as they do today. The recommendation for production animation is no-go: the pinned WebP codec is libwebp 1.1.0, which is older than the fix for CVE-2023-4863. Do not decode an untrusted WebP with it.</p>
<button id="sample" type="button">Run the built-in sample</button>
<p id="result" role="status"></p>
<details>
<summary>libwebp licence</summary>
<pre>${escaped}</pre>
</details>
<script>${js}</script>
</body>
</html>
`;
const style = body.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = body.match(/<script>([\s\S]*?)<\/script>/)[1];
const policy = `default-src 'none'; script-src 'wasm-unsafe-eval' 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
const html = body.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
await writeFile("animation-prototype.html", html);
console.log(`Built animation prototype (${Math.round(Buffer.byteLength(html) / 1024)} KiB).`);
