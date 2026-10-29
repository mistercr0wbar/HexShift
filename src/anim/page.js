import {
  ENVELOPE,
  codecMemory,
  decodeAnimation,
  encodeAnimation,
  inspectAnimation,
  samplePoint,
} from "./prototype.js";

function solid(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return data;
}

async function runSample() {
  const result = document.querySelector("#result");
  const red = solid(4, 2, [255, 0, 0, 255]);
  const green = solid(4, 2, [0, 255, 0, 128]);
  const gif = await encodeAnimation("gif", {
    width: 4,
    height: 2,
    loop: 0,
    frames: [
      { data: red, durationMs: 100 },
      { data: red, durationMs: 100 },
    ],
  });
  const gifOut = await decodeAnimation(gif);
  const webp = await encodeAnimation("webp", {
    width: 4,
    height: 2,
    loop: 0,
    frames: [
      { data: red, durationMs: 40, blend: 1 },
      { data: green, durationMs: 40, blend: 0 },
    ],
  });
  const webpOut = await decodeAnimation(webp);
  const pixel = webpOut.frames[1].data;
  const blended = pixel[0] === 127 && pixel[1] === 128 && pixel[2] === 0 && pixel[3] === 255;
  const codec = await codecMemory();
  gifOut.close();
  webpOut.close();
  if (gifOut.frames.length !== 2 || !blended)
    throw Error("The built-in sample did not round-trip.");
  result.textContent =
    "GIF " +
    gifOut.frames.length +
    " frames match. WebP " +
    webpOut.frames.length +
    " frames match. libwebp " +
    codec.libwebp +
    ".";
}

document.querySelector("#sample").addEventListener("click", () => {
  runSample().catch((error) => {
    document.querySelector("#result").textContent = error.message;
  });
});

window.hexshiftAnimation = {
  ENVELOPE,
  codecMemory,
  decodeAnimation,
  encodeAnimation,
  inspectAnimation,
  samplePoint,
};
