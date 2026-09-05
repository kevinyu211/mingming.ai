import { READ_MAX_BODY_BYTES } from "@/lib/domain/read-policy";

/** The temporary navigation payload and the exact byte size the read endpoint will receive. */
export function pendingImagePayload(
  pages: readonly { mediaType: "image/jpeg"; base64: string }[],
): { pending: string; requestBytes: number; tooLarge: boolean } {
  const pending = JSON.stringify(pages.map(({ mediaType, base64 }) => ({ mediaType, base64 })));
  const requestBytes = new TextEncoder().encode(`{"images":${pending}}`).byteLength;
  return { pending, requestBytes, tooLarge: requestBytes > READ_MAX_BODY_BYTES };
}
