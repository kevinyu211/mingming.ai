/**
 * The name a sheet is filed under (v2 build brief §5).
 *
 * Pure: a reading in, a string out. No clock, no storage, no model.
 *
 * The one rule that matters here is that a title is never invented. The prototype files its
 * sheets under 「瑪麗醫院 · 心內科」, and that is fixture text on a mock — a real reading only ever
 * carries a hospital or a department if the page actually printed one. So the derivation is a
 * strict order of *printed* sources, and when the page printed neither, the title is the fixed
 * word for what the thing is:
 *
 *   1. the first `followUp[].clinic` that printed anything
 *   2. else the first non-empty line of `hospitalContact.text`, cut at the first punctuation mark
 *   3. else 出院紙 / 出院纸 / "Discharge sheet"
 *
 * The clinic comes first because `hospitalContact` is a CONTACT line, and on a real sheet it is
 * usually a phone number with a label rather than a name for the document. All three checked-in
 * fixtures show it: `hk_en` prints "Ward enquiries: 2xxx xxxx" (titling the sheet "Ward
 * enquiries") and both `cn_zh` sheets print 「联系电话：0XXX-XXXXXXX（心内科病房）」, which cuts to
 * the bare word 「联系电话」. Their `followUp[].clinic` values are "SOPD" and 「心内科门诊」 — which
 * is what the paper is actually about, and what the canvas puts in the header. When a page happens
 * to print a hospital name in its contact block, step 2 still picks it up.
 *
 * Every result of steps 1 and 2 is a *prefix* of text the page printed, never a rewrite of it, so
 * a title can be checked against the paper character for character. A model turn never touches it.
 */
import type { SheetReading, StoredReading } from "@/lib/domain/schemas";
import type { UiLocale } from "@/lib/storage/local";

/**
 * The fixed title, used when the page named no hospital and no clinic. Keyed by `UiLocale`
 * because all three differ: traditional characters for the Cantonese interface, simplified for
 * the Mandarin one, English for the English one.
 */
export const FALLBACK_TITLE: Record<UiLocale, string> = {
  hant: "出院紙",
  hans: "出院纸",
  en: "Discharge sheet",
};

/**
 * Where a printed contact line stops being a name and starts being an address, a phone number or
 * a second sentence. Deliberately excludes the middle dot 「·」 and the hyphen, which a sheet uses
 * *inside* a name ("瑪麗醫院 · 心內科", "Queen Mary Hospital - Cardiology"), and includes the line
 * break, because the second line of a contact block is the street, never the hospital.
 */
const TITLE_STOP = /[\n\r，,。．.、；;：:！!？?（）()【】\[\]「」『』〈〉<>|｜/／\\]/;

/**
 * A title longer than this is not a name, it is a paragraph that happened to contain no
 * punctuation. It is cut rather than dropped: the result is still a prefix of the printed line,
 * so it still says only what the page says.
 */
const MAX_TITLE = 40;

/** The first line that has anything on it, or "" when the whole value is blank. */
function firstLine(value: string): string {
  for (const line of value.split(/[\n\r]+/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/** Cuts at the first stop character and trims, then caps the length. Always returns a prefix. */
function upToFirstStop(value: string): string {
  const line = firstLine(value);
  if (line.length === 0) return "";
  const stop = line.search(TITLE_STOP);
  const head = (stop === -1 ? line : line.slice(0, stop)).trim();
  return head.length > MAX_TITLE ? head.slice(0, MAX_TITLE).trim() : head;
}

/**
 * The sheet's title in the reader's own interface language.
 *
 * `script` is the interface locale rather than only the written form, because the fallback is a
 * different word in all three — the two Chinese forms differ by script, English by language.
 *
 * A `null` reading (nothing photographed yet) returns the fallback rather than throwing, so the
 * shell can label an empty state without a special case.
 */
export function sheetTitle(
  reading: SheetReading | StoredReading | null | undefined,
  script: UiLocale,
): string {
  const fallback = FALLBACK_TITLE[script] ?? FALLBACK_TITLE.hant;
  if (!reading) return fallback;

  for (const item of reading.followUp ?? []) {
    const clinic = upToFirstStop(item.clinic ?? "");
    if (clinic.length > 0) return clinic;
  }

  const contact = upToFirstStop(reading.hospitalContact?.text ?? "");
  if (contact.length > 0) return contact;

  return fallback;
}
