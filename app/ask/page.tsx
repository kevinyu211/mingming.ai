import { redirect } from "next/navigation";

/**
 * `/ask` is gone. A question is not a separate screen any more — it goes into the same thread the
 * sheet arrived in, on `/chat` (v2 build brief §1). This route stays only so old links, bookmarks
 * and any `<Link href="/ask">` left in the wild still land somewhere sensible.
 *
 * A server-component `redirect` (307) runs before anything renders, so there is no flash of an
 * empty ask screen.
 */
export default function AskRedirect(): never {
  redirect("/chat");
}
