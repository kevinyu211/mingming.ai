import { redirect } from "next/navigation";

/**
 * `/ask` is gone. Reading a sheet and asking about it now happen in one conversation on `/read`
 * (the product owner's "one screen, not two" direction). This route stays only so old links,
 * bookmarks and any `<Link href="/ask">` left in the wild still land somewhere sensible.
 *
 * A server-component `redirect` (307) runs before anything renders, on both a hard load and a
 * client navigation, so there is no flash of an empty ask screen. The reading, the voice bar and
 * every ask outcome live on `/read` now (`app/read/page.tsx`).
 */
export default function AskRedirect(): never {
  redirect("/read");
}
