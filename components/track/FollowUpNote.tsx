"use client";

/**
 * 明明 on 跟進: one line, in his bubble, in his voice, built from the counters on this screen.
 *
 * Until now this was the only screen where the companion said nothing — the same figure sat in
 * a greeting pose above a dashboard. The line is rule copy (`components/track/followup.ts`), so
 * it can only restate what the cards below already show; it is typed out and spoken through the
 * same `useVoice` the conversation uses, once per visit, and 讀多次 says it again on a tap.
 *
 * Autoplay here works for the same reason it works in the chat: the tab switch is client-side
 * routing, so the audio element unlocked on the consent tap is still the one speaking. If the
 * browser refuses anyway, the words are already on the screen and nothing is reported — the
 * 「出唔到聲」 note belongs to the conversation, where silence would otherwise go unexplained.
 */
import { useEffect, useRef } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Spark from "@/components/chat/Spark";
import { useVoice } from "@/components/chat/useVoice";

export default function FollowUpNote({ text }: { text: string }) {
  const { dialect, t } = useLocale();
  const voice = useVoice(dialect, true);
  const said = useRef<string | null>(null);

  useEffect(() => {
    if (text.length === 0 || said.current === text) return;
    said.current = text;
    voice.say(text);
    // Speak once per distinct line; `voice` is stable for the mount and re-running on it would
    // repeat the line on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => () => voice.cancel(), [voice]);

  if (text.length === 0) return null;
  const shown = voice.typing ?? text;

  return (
    <div className="animate-rise mt-4 flex items-end gap-2.5 pr-8" data-testid="followup-note">
      <Spark className="mb-1" />
      <div className="min-w-0 flex-1">
        <div className="surface rounded-[18px_18px_18px_4px] px-4 py-3.5">
          <p className="text-[17px] leading-[26px] break-words whitespace-pre-line text-ink">{shown}</p>
          <div className="mt-1.5 flex items-center gap-x-3">
            <button
              type="button"
              onClick={() => voice.resay(text)}
              aria-label={t("chat.speakAgain")}
              className="flex min-h-9 items-center gap-1.5 text-fine font-semibold text-jade-ink"
            >
              <span aria-hidden="true">{voice.speaking ? "▮▮▮" : "🔊"}</span>
              {voice.speaking ? t("chat.reading") : t("chat.speakAgain")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
