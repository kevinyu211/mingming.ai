"use client";

/**
 * The 傾偈 header: back to 記錄, the sheet being talked about, the speaker toggle, the language chip.
 *
 * `/chat` is full-screen and has no tab bar (v2 build brief §1) — it is a conversation, so it gets
 * a back arrow the way a WeChat thread does. The title is derived by `sheetTitle()` from the
 * reading, never invented: when the page named no hospital and no clinic it says 出院紙, which is
 * the honest answer (`lib/sheets/title.ts`).
 *
 * The speaker toggle is **the only voice control on this screen**. Silencing it stops the audio
 * and the text keeps typing; there is no play button and the 讀住 waveform is not one.
 */
import { useMemo } from "react";
import BottomSheet from "@/components/BottomSheet";
import { useLocale } from "@/components/LocaleProvider";
import type { Dialect } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";

/**
 * The 48 px chip's glyph. Copy with no key in `lib/i18n/ui.ts` — the file has the full names
 * (`language.yue` etc.) but not the one-or-two character forms the canvas puts in the chip.
 * Reported upward rather than added here; same rules as everything in that file.
 */
const CHIP: Record<Dialect, string> = { yue: "粵", cmn: "普", en: "EN" };

/** Which interface language each spoken language belongs with. */
const LOCALE_FOR: Record<Dialect, UiLocale> = { yue: "hant", cmn: "hans", en: "en" };

const CHOICES: { dialect: Dialect; key: "language.yue" | "language.cmn" | "language.en" }[] = [
  { dialect: "yue", key: "language.yue" },
  { dialect: "cmn", key: "language.cmn" },
  { dialect: "en", key: "language.en" },
];

export interface ChatHeaderProps {
  title: string;
  /** ISO timestamp the sheet was photographed. Rendered as 「9月1日出院紙」. */
  capturedAt: string;
  speakerOn: boolean;
  onToggleSpeaker: () => void;
  onBack: () => void;
  langOpen: boolean;
  onOpenLang: () => void;
  onCloseLang: () => void;
}

/**
 * 「9月1日」 in Chinese, 「1 Sep」 in English, from the device's own formatter. An unparseable
 * timestamp yields "" and the line is dropped rather than showing "Invalid Date".
 */
function formatDay(iso: string, locale: UiLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tag = locale === "en" ? "en-GB" : locale === "hans" ? "zh-CN" : "zh-HK";
  try {
    return new Intl.DateTimeFormat(tag, { month: "long", day: "numeric" }).format(date);
  } catch {
    return "";
  }
}

export default function ChatHeader({
  title,
  capturedAt,
  speakerOn,
  onToggleSpeaker,
  onBack,
  langOpen,
  onOpenLang,
  onCloseLang,
}: ChatHeaderProps) {
  const { t, locale, dialect, setDialect, setLocale } = useLocale();
  const day = useMemo(() => formatDay(capturedAt, locale), [capturedAt, locale]);

  const choose = (next: Dialect) => {
    // Dialect first, then locale: `setDialect` moves the card script to the dialect's own written
    // form, and `setLocale` is what the reader actually picked, so it has to land last.
    setDialect(next);
    setLocale(LOCALE_FOR[next]);
    onCloseLang();
  };

  return (
    <header className="relative z-10 flex shrink-0 items-center gap-1.5 border-b border-hairline bg-ground px-3.5 pt-2 pb-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("chat.back")}
        className="tap shrink-0 text-[26px] leading-none text-muted"
      >
        <span aria-hidden="true">‹</span>
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[19px] leading-[1.3] font-bold text-ink">{title}</h1>
        {day ? (
          <p className="mt-px text-meta text-muted">{t("chat.sheetLine").replace("{date}", day)}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onToggleSpeaker}
        // The label names the ACTION and changes with the state, so no `aria-pressed`: a toggle
        // announced as 「熄咗把聲, pressed」 makes a screen reader say the opposite of what it means.
        aria-label={speakerOn ? t("chat.muteSpeaker") : t("chat.unmuteSpeaker")}
        className={`tap shrink-0 rounded-full ${speakerOn ? "bg-jade-tint-2 text-jade-ink" : "bg-neutral text-muted"}`}
      >
        <SpeakerMark on={speakerOn} />
      </button>

      <button
        type="button"
        onClick={onOpenLang}
        aria-label={t("chat.language")}
        className="tap shrink-0 rounded-full bg-neutral text-[16px] font-medium text-ink"
      >
        {CHIP[dialect]}
      </button>

      <BottomSheet open={langOpen} onClose={onCloseLang} title={t("chat.language")}>
        <ul className="flex flex-col gap-2.5">
          {CHOICES.map((choice) => {
            const on = choice.dialect === dialect;
            return (
              <li key={choice.dialect}>
                <button
                  type="button"
                  onClick={() => choose(choice.dialect)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-3 rounded-[16px] px-5 py-5 text-[19px] font-medium ${
                    on ? "bg-jade-tint-2 text-jade-ink" : "surface text-ink"
                  }`}
                >
                  <span aria-hidden="true" className="w-6 text-center">
                    {on ? "✓" : ""}
                  </span>
                  {t(choice.key)}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </header>
  );
}

function SpeakerMark({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 18 16"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M8.4 2.2 5.1 5.2H2.4v5.6h2.7l3.3 3V2.2Z" />
      {on ? <path d="M11.6 5.4a3.7 3.7 0 0 1 0 5.2M14.2 3.2a7 7 0 0 1 0 9.6" /> : null}
      {on ? null : <path d="M12 6l4 4M16 6l-4 4" />}
    </svg>
  );
}
