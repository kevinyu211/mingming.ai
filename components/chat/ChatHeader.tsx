"use client";

/**
 * The 傾偈 header (Companion D): a pill back to 記錄, 明明 and his name in the middle, the speaker
 * and the language pill on the right.
 *
 * `/chat` is full-screen and has no tab bar (v2 build brief §1) — it is a conversation, so it gets
 * a way back the way a WeChat thread does. The sheet's title sits under the name, derived by
 * `sheetTitle()` from the reading and never invented: when the page named no hospital and no
 * clinic it says 出院紙, which is the honest answer (`lib/sheets/title.ts`).
 *
 * The speaker toggle is **the only voice control on this screen**. Silencing it stops the audio
 * and the text keeps typing; there is no play button and the 讀住 waveform is not one.
 */
import BottomSheet from "@/components/BottomSheet";
import { useLocale } from "@/components/LocaleProvider";
import Mascot, { type MascotState } from "@/components/Mascot";
import Wordmark from "@/components/Wordmark";
import type { Dialect } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/i18n/ui";

/** The pill's glyph: the one-or-two character forms the design puts in the language chip. */
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
  /** ISO timestamp the sheet was photographed. Kept for callers; the design shows the title alone. */
  capturedAt: string;
  speakerOn: boolean;
  onToggleSpeaker: () => void;
  onBack: () => void;
  langOpen: boolean;
  onOpenLang: () => void;
  onCloseLang: () => void;
  /** Live companion in the chrome. Defaults to idle when the thread is quiet. */
  mascotState?: MascotState;
}

export default function ChatHeader({
  title,
  speakerOn,
  onToggleSpeaker,
  onBack,
  langOpen,
  onOpenLang,
  onCloseLang,
  mascotState = "idle",
}: ChatHeaderProps) {
  const { t, dialect, setDialect, setLocale } = useLocale();

  const choose = (next: Dialect) => {
    // Dialect first, then locale: `setDialect` moves the card script to the dialect's own written
    // form, and `setLocale` is what the reader actually picked, so it has to land last.
    setDialect(next);
    setLocale(LOCALE_FOR[next]);
    onCloseLang();
  };

  return (
    <header className="relative z-10 flex shrink-0 items-center justify-between gap-2 border-b border-hairline bg-ground/80 px-3 pt-2 pb-2.5 backdrop-blur-xl lg:px-6 lg:py-3.5">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("chat.back")}
        className="pill min-h-10 shrink-0 pl-2.5 lg:hidden"
      >
        <span aria-hidden="true" className="-mr-1 text-[18px] leading-none text-muted">
          ‹
        </span>
        <HomeGlyph />
        {t("tab.record")}
      </button>
      {/* On a desktop the rail is the way back, so the middle block starts the row. */}
      <span className="hidden lg:block" />

      <div className="flex min-w-0 items-center gap-2.5">
        <span className="companion-plate grid h-11 w-11 shrink-0 place-items-center rounded-full">
          <Mascot size={44} state={mascotState} />
        </span>
        <div className="min-w-0">
          <Wordmark />
          <h1 className="truncate text-[12px] leading-[1.3] font-normal tracking-normal text-muted">
            {title}
          </h1>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleSpeaker}
          // The label names the ACTION and changes with the state, so no `aria-pressed`: a toggle
          // announced as 「熄咗把聲, pressed」 makes a screen reader say the opposite of what it means.
          aria-label={speakerOn ? t("chat.muteSpeaker") : t("chat.unmuteSpeaker")}
          className={`tap shrink-0 rounded-full ${speakerOn ? "text-ink" : "bg-neutral text-muted"}`}
        >
          <SpeakerMark on={speakerOn} />
        </button>

        <button
          type="button"
          onClick={onOpenLang}
          aria-label={t("chat.language")}
          className="pill min-h-9 shrink-0 px-3 text-[13px]"
        >
          {CHIP[dialect]}
          <span aria-hidden="true" className="text-[10px] text-faint">
            ⌄
          </span>
        </button>
      </div>

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
                    on ? "bg-ink text-white" : "surface border border-hairline text-ink"
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

function HomeGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 10.5 12 4l8 6.5V20H4v-9.5Z" />
    </svg>
  );
}

function SpeakerMark({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M4 9.5v5h3l4 3.5V6L7 9.5H4Z" />
      {on ? <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" /> : null}
      {on ? null : <path d="M15 9l5 6M20 9l-5 6" />}
    </svg>
  );
}
