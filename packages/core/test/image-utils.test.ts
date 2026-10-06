import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGE_TOKEN_ESTIMATE } from "../src/util/constants.js";
import { estimateImageTokens, imageDimensions } from "../src/util/file.js";

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function gifHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(10);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

function jpegHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(29);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  buffer.writeUInt16BE(16, 4);
  buffer.write("JFIF", 6, "ascii");
  buffer[20] = 0xff;
  buffer[21] = 0xc0;
  buffer.writeUInt16BE(17, 22);
  buffer[24] = 8;
  buffer.writeUInt16BE(height, 25);
  buffer.writeUInt16BE(width, 27);
  return buffer;
}

function webpVp8xHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function webpVp8Header(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer[23] = 0x9d;
  buffer[24] = 0x01;
  buffer[25] = 0x2a;
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

function webpVp8lHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(25);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8L", 12, "ascii");
  buffer[20] = 0x2f;
  buffer.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  return buffer;
}

test("imageDimensions reads the size from every supported header", () => {
  assert.deepEqual(imageDimensions(pngHeader(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(gifHeader(320, 200)), { width: 320, height: 200 });
  assert.deepEqual(imageDimensions(jpegHeader(1024, 768)), { width: 1024, height: 768 });
  assert.deepEqual(imageDimensions(webpVp8xHeader(2048, 1024)), { width: 2048, height: 1024 });
  assert.deepEqual(imageDimensions(webpVp8Header(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(webpVp8lHeader(512, 256)), { width: 512, height: 256 });
});

test("imageDimensions returns undefined for non-images and truncated headers", () => {
  assert.equal(imageDimensions(Buffer.from("plain text")), undefined);
  assert.equal(imageDimensions(pngHeader(640, 480).subarray(0, 16)), undefined);
  assert.equal(imageDimensions(Buffer.from([0xff, 0xd8, 0xff])), undefined);
});

test("estimateImageTokens derives tokens from the pixel area", () => {
  assert.equal(estimateImageTokens(pngHeader(640, 480)), 410);
  assert.equal(estimateImageTokens(gifHeader(320, 200)), 86);
  assert.equal(estimateImageTokens(pngHeader(1568, 1000)), 2091);
});

test("estimateImageTokens scales images whose longest edge exceeds 1568", () => {
  assert.equal(estimateImageTokens(pngHeader(4000, 3000)), 2459);
  assert.equal(estimateImageTokens(webpVp8xHeader(2048, 1024)), 1640);
});

test("estimateImageTokens falls back to the flat estimate for unreadable headers", () => {
  assert.equal(estimateImageTokens(Buffer.from("not an image")), IMAGE_TOKEN_ESTIMATE);
});
