import { describe, expect, it } from "vitest";
import {
  approximateBytes,
  base64FromDataUrl,
  downscale,
  JPEG_QUALITY,
  MAX_LONG_EDGE,
  targetSize,
} from "@/lib/image/downscale";

describe("targetSize", () => {
  it("leaves a photo that is already small alone", () => {
    expect(targetSize(1200, 900)).toEqual({ width: 1200, height: 900 });
    expect(targetSize(MAX_LONG_EDGE, 800)).toEqual({ width: MAX_LONG_EDGE, height: 800 });
  });

  it("caps the long edge and keeps the aspect ratio, landscape or portrait", () => {
    // A 12 MP phone photo, both ways up.
    expect(targetSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(targetSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it("never upscales", () => {
    const small = targetSize(320, 240);
    expect(Math.max(small.width, small.height)).toBe(320);
  });

  it("honours a custom cap", () => {
    expect(targetSize(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it("never returns a zero dimension for a sliver of a page", () => {
    const sliver = targetSize(4000, 3);
    expect(sliver.width).toBe(1600);
    expect(sliver.height).toBeGreaterThanOrEqual(1);
  });

  it("clamps nonsense input rather than producing a NaN canvas", () => {
    expect(targetSize(0, 0)).toEqual({ width: 1, height: 1 });
    expect(targetSize(-10, 20)).toEqual({ width: 1, height: 20 });
  });
});

describe("base64FromDataUrl", () => {
  it("returns only the payload, never the data: prefix", () => {
    expect(base64FromDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe("/9j/4AAQSkZJRg==");
  });

  it("returns empty for anything that is not a data URL", () => {
    expect(base64FromDataUrl("https://example.test/a.jpg")).toBe("");
    expect(base64FromDataUrl("")).toBe("");
    expect(base64FromDataUrl("data:image/jpeg;base64")).toBe("");
  });
});

describe("approximateBytes", () => {
  it("accounts for base64 padding", () => {
    expect(approximateBytes("")).toBe(0);
    // "AAAA" is 3 bytes; one and two padding characters take one byte off each.
    expect(approximateBytes("AAAA")).toBe(3);
    expect(approximateBytes("AAA=")).toBe(2);
    expect(approximateBytes("AA==")).toBe(1);
  });
});

describe("contract constants", () => {
  it("matches contracts/api-read.md", () => {
    expect(MAX_LONG_EDGE).toBe(1600);
    expect(JPEG_QUALITY).toBe(0.85);
  });
});

describe("downscale", () => {
  // The canvas half needs a real browser; the e2e run covers it. Here we only assert that it
  // refuses to pretend outside one, rather than silently returning something unusable.
  it("refuses to run without a DOM", async () => {
    expect(typeof document).toBe("undefined");
    await expect(downscale(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow(/browser/i);
  });
});
