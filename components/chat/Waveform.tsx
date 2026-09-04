/**
 * The 讀住 indicator: four bars that rise and fall while 明明 is actually speaking.
 *
 * **It is status, never a control** (v2 build brief §6). There is no play button in this product,
 * so this is not a disabled one — it is the same thing as a "typing…" bubble in a chat app: it
 * tells you sound is happening, and it goes away when the sound does. It is `aria-hidden` and the
 * word beside it (讀住 / 讀住呢段) is the real text, so a screen reader hears the state once.
 *
 * The bar heights and the 0.9 s stagger are the design canvas's. `animate-wv` is defined in
 * globals.css and is killed by `prefers-reduced-motion`, which leaves four static bars — still a
 * visible marker, just not a moving one.
 */
export type WaveformTone = "jade" | "warn";

/** Canvas geometry: uneven heights, so it reads as a voice rather than as a loading spinner. */
const BARS = [45, 100, 65, 88];

export default function Waveform({
  tone = "jade",
  className = "",
}: {
  tone?: WaveformTone;
  className?: string;
}) {
  const colour = tone === "warn" ? "var(--warn-stroke)" : "var(--jade-ink)";
  return (
    <span
      aria-hidden="true"
      className={`flex h-[15px] items-end gap-[2.5px] ${className}`}
    >
      {BARS.map((height, i) => (
        <span
          key={height + "-" + i}
          className="animate-wv w-[3px] rounded-[2px]"
          style={{ height: `${height}%`, background: colour, animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </span>
  );
}
