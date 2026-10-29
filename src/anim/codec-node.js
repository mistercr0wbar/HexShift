// Test-only loader. The browser bundle embeds the wasm and does not import this file.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setWasmBytes } from "./codec.js";

const root = fileURLToPath(new URL("../../node_modules/@jsquash/webp/", import.meta.url));
setWasmBytes({
  dec: await readFile(root + "codec/dec/webp_dec.wasm"),
  enc: await readFile(root + "codec/enc/webp_enc.wasm"),
});
