// Build the Windows, web and Android icons with the same split hash.
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const graphite = "#232529";
const amber = "#f2a35a";
const warmWhite = "#f5f1ea";
const hash =
  "M33 20h12v60H33z M55 20h12v60H55z M20 33h60v12H20z M20 55h60v12H20z";
const foreground = `
  <clipPath id="split"><path d="M0 0H100L0 100Z"/></clipPath>
  <path d="${hash}" fill="${amber}"/>
  <path d="${hash}" fill="${warmWhite}" clip-path="url(#split)"/>`;
const square = `<rect width="100" height="100" fill="${graphite}"/>`;
const adaptive = (content) =>
  `<g transform="translate(7.5 7.5) scale(.85)">${content}</g>`;
const mark = {
  tile: `<rect x="4" y="4" width="92" height="92" rx="21" fill="${graphite}"/>${foreground}`,
  maskable: square + foreground,
  background: square,
  foreground: adaptive(foreground),
  monochrome: adaptive(`<path d="${hash}" fill="white"/>`),
};

function png(size, kind) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${mark[kind]}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const assets = [
  ["icons/icon-192.png", 192, "tile"],
  ["icons/icon-512.png", 512, "tile"],
  ["icons/icon-512-maskable.png", 512, "maskable"],
  ["icons/apple-touch-icon.png", 180, "maskable"],
  ["icons/android/ic_launcher_background.png", 432, "background"],
  ["icons/android/ic_launcher_foreground.png", 432, "foreground"],
  ["icons/android/ic_launcher_monochrome.png", 432, "monochrome"],
];
await Promise.all(
  assets.map(async ([path, size, kind]) =>
    writeFile(path, await png(size, kind)),
  ),
);

// Windows ICO uses a directory followed by one PNG per size.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((size) => png(size, "tile")));
const directory = Buffer.alloc(6 + 16 * images.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
images.forEach((image, i) => {
  const entry = 6 + 16 * i;
  directory[entry] = directory[entry + 1] = sizes[i] % 256;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile("app/icon.ico", Buffer.concat([directory, ...images]));
