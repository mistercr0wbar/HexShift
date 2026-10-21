import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
test("portable CSP hashes exactly match browser-parsed inline content", async () => {
  const html = await readFile("HexShift.html", "utf8"),
    policy = html.match(/content="(default-src [^"]+)"/)[1];
  assert.ok(!html.includes("\r"));
  for (const tag of ["script", "style"]) {
    const body = html.match(
      new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"),
    )[1];
    const digest = createHash("sha256").update(body).digest("base64");
    assert.ok(
      policy.includes("'sha256-" + digest + "'"),
      tag + " hash must include all parser whitespace",
    );
  }
  assert.ok(!html.includes("__SCRIPT__"));
  assert.ok(html.includes("licence-notices"));
  assert.ok(!/src="https?:\/\//i.test(html));
});
