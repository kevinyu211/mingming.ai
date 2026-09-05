/**
 * The assistant's avatar in the thread: a 28 px lilac-to-rose disc with a ✦ (Companion D).
 *
 * Decoration. 明明's name is real text in the header and on 記錄, so the disc says nothing to a
 * screen reader; a label here would make his name read twice.
 */
export default function Spark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`spark h-7 w-7 shrink-0 text-[13px] leading-none ${className}`}
    >
      ✦
    </span>
  );
}
