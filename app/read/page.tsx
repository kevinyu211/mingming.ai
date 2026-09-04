import { redirect } from "next/navigation";

/**
 * `/read` is gone. Reading a sheet and talking about it are one conversation now, on `/chat`
 * (v2 build brief §1). This route stays so old links, bookmarks and the e2e suite still land
 * somewhere sensible.
 *
 * The `?sample=` parameter is carried across, because it is the one-tap way out of every failure
 * path (FR-023/FR-024) and a judge following a printed link must still reach the bundled sheet.
 * Nothing else is forwarded: no other query string on this route ever meant anything.
 *
 * A server-component `redirect` (307) runs before anything renders, on a hard load and on a client
 * navigation alike, so there is no flash of an empty screen.
 */
export default async function ReadRedirect({
  searchParams,
}: PageProps<"/read">): Promise<never> {
  const sample = (await searchParams).sample;
  const id = Array.isArray(sample) ? sample[0] : sample;
  redirect(id ? `/chat?sample=${encodeURIComponent(id)}` : "/chat");
}
