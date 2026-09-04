import { redirect } from "next/navigation";

/**
 * `/plan` is gone. The follow-up is not a screen you confirm a draft on any more — it is 跟進, the
 * third tab, showing the ONE active sheet's appointment, medicines and warning signs (v2 build
 * brief §1). This route stays only so old links, bookmarks and any `<Link href="/plan">` left in
 * the wild still land somewhere sensible.
 *
 * A server-component `redirect` (307) runs before anything renders, so there is no flash of an
 * empty plan screen.
 */
export default function PlanRedirect(): never {
  redirect("/track");
}
