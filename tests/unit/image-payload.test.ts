import { describe, expect, it } from "vitest";
import { pendingImagePayload } from "@/lib/image/payload";
import { READ_MAX_BODY_BYTES } from "@/lib/domain/read-policy";

describe("capture submission preflight", () => {
  it("keeps all six images in order and sends only the accepted wire fields", () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({
      mediaType: "image/jpeg" as const,
      base64: String(i),
      width: 1600,
      height: 1000,
    }));
    const result = pendingImagePayload(pages);
    const images = JSON.parse(result.pending);
    expect(images).toEqual(pages.map(({ mediaType, base64 }) => ({ mediaType, base64 })));
    expect(result.requestBytes).toBe(new TextEncoder().encode(JSON.stringify({ images })).byteLength);
    expect(result.tooLarge).toBe(false);
  });

  it("checks the encoded request ceiling, including its JSON envelope", () => {
    const overhead = pendingImagePayload([{ mediaType: "image/jpeg", base64: "" }]).requestBytes;
    const exact = { mediaType: "image/jpeg" as const, base64: "A".repeat(READ_MAX_BODY_BYTES - overhead) };
    expect(pendingImagePayload([exact]).tooLarge).toBe(false);
    expect(pendingImagePayload([{ ...exact, base64: exact.base64 + "A" }]).tooLarge).toBe(true);
  });
});
