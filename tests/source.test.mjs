import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// The page, the scripts, the styles, the tests and the docs are UTF-8 without a
// byte-order mark, and the arrows, dots and quotation marks in them are real
// characters. A tool that reads UTF-8 as Windows-1252 and saves it again turns
// each of them into two or three odd ones, without any error, so this looks for
// the result.
const TEXT = /\.(js|mjs|css|html|md|json|yml)$/;
async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (TEXT.test(entry.name)) found.push(path);
  }
  return found;
}
// A lead byte of UTF-8 read as Windows-1252 (Â, Ã, â) followed by the character
// a continuation byte becomes in that encoding.
const CONTINUATION =
  "\\u0080-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e\\u0192\\u02c6\\u02dc" +
  "\\u2013\\u2014\\u2018-\\u201e\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122";
const MOJIBAKE = new RegExp(`[\\u00c2\\u00c3\\u00e2][${CONTINUATION}]`);

test("source files have no byte-order mark and no text decoded with the wrong encoding", async () => {
  const dirs = ["src", "tests", "docs", "scripts"],
    list = [
      ...(await Promise.all(dirs.map((d) => files(d)))).flat(),
      "README.md",
      "package.json",
    ];
  assert.ok(list.length > 40, "found the source files");
  const bad = [];
  for (const path of list) {
    // The sample's data URL and the generated page are not hand-written text.
    if (path.endsWith("sample.js")) continue;
    const bytes = await readFile(path),
      text = bytes.toString("utf8");
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      bad.push(path + ": starts with a byte-order mark");
    const hit = text.match(MOJIBAKE);
    if (hit)
      bad.push(
        path +
          ": " +
          JSON.stringify(
            text.slice(Math.max(0, hit.index - 15), hit.index + 15),
          ),
      );
  }
  assert.deepEqual(bad, []);
});

test("the characters the interface draws are intact in the built page", async () => {
  const page = await readFile("HexShift.html", "utf8");
  // From the menus, the panels and the status line.
  const lower = page.toLowerCase();
  for (const mark of ["▸", "✓", "●", "‹", "→", "·", "…", "⚠"])
    assert.ok(page.includes(mark) || lower.includes(escape4(mark)), mark);
  assert.equal(MOJIBAKE.test(page.replace(/<pre>[\s\S]*?<\/pre>/g, "")), false);
});
// esbuild writes non-ASCII characters in the script as \uXXXX escapes.
const escape4 = (c) => "\\u" + c.codePointAt(0).toString(16).padStart(4, "0");
