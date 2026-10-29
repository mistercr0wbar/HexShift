// Pinned still-WebP codec. The heap belongs to libwebp and is not an application buffer.
import decFactory from "@jsquash/webp/codec/dec/webp_dec.js";
import encFactory from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";

let bins = null;
let dec = null;
let enc = null;

export function setWasmBytes(next) {
  bins = { dec: next.dec, enc: next.enc };
  dec = null;
  enc = null;
}

async function loadBytes() {
  if (bins) return bins;
  if (typeof __WEBP_DEC_B64__ !== "undefined") {
    bins = { dec: fromBase64(__WEBP_DEC_B64__), enc: fromBase64(__WEBP_ENC_B64__) };
    return bins;
  }
  throw Error("WebP codec bytes were not configured.");
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function versionOf(module) {
  const n = module.version();
  return `${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

function codecOptions(bytes) {
  return {
    wasmBinary: bytes,
    noInitialRun: true,
    // The glue otherwise does `new URL("webp_dec.wasm", import.meta.url)`, which
    // throws in the browser bundle. The bytes above are used instead of a fetch.
    locateFile: (path) => path,
  };
}

async function modules() {
  if (dec && enc) return { dec, enc };
  const bytes = await loadBytes();
  dec = await decFactory(codecOptions(bytes.dec));
  // Non-SIMD build on purpose: one reviewed binary, including machines without WASM SIMD.
  enc = await encFactory(codecOptions(bytes.enc));
  return { dec, enc };
}

export async function decodeStill(bytes) {
  const { dec: module } = await modules();
  const image = module.decode(bytes);
  if (!image) throw Error("This browser cannot decode that WebP frame.");
  return image;
}

export async function encodeStill(data, width, height) {
  const { enc: module } = await modules();
  const encoded = module.encode(data, width, height, {
    ...defaultOptions,
    lossless: 1,
    exact: 1,
    quality: 100,
  });
  if (!encoded) throw Error("This browser cannot encode that WebP frame.");
  return encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
}

export async function codecMemory() {
  const bytes = await loadBytes();
  const ready = dec && enc ? { dec, enc } : null;
  return {
    libwebp: ready ? versionOf(ready.dec) : null,
    decoderWasmBytes: bytes.dec.byteLength,
    encoderWasmBytes: bytes.enc.byteLength,
    decoderHeapBytes: ready?.dec.HEAPU8?.buffer.byteLength ?? 0,
    encoderHeapBytes: ready?.enc.HEAPU8?.buffer.byteLength ?? 0,
  };
}
