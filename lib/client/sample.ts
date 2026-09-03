/**
 * The bundled sample sheets (FR-023, FR-024).
 *
 * Three synthetic readings ship with the app so the whole flow can be shown when the camera is
 * unavailable, the network is gone, or the reading service is down — and so a judge can see the
 * product in two taps. They are the same fixtures the unit tests parse, which is the point: the
 * demo path and the tested path are one path.
 *
 * A sample never reaches a model. The reading is already structured, so this module only does
 * what the read route would have done afterwards: the deterministic diet rules, the fixed card
 * order, and one defensive pass of the banned-term filter (constitution principles III and VI).
 * `sample: true` is set here so the banner cannot be forgotten.
 */
import { SheetReadingSchema, type Card, type StoredReading } from "@/lib/domain/schemas";
import { checkCard } from "@/lib/rules/banned-terms";
import { buildCards } from "@/lib/rules/card-order";
import { applyDietRules } from "@/lib/rules/diet-line";
import { templateFor } from "@/lib/rules/template-fallback";

/** The three fixtures from `fixtures/sheets/`. */
export type SampleId = "hk_en" | "cn_zh" | "cn_zh_photo";

export const SAMPLE_IDS: SampleId[] = ["hk_en", "cn_zh", "cn_zh_photo"];

/** The sheet offered by every "use a sample sheet" button: the Hong Kong English demo case. */
export const DEFAULT_SAMPLE: SampleId = "hk_en";

export interface SampleReading {
  reading: StoredReading;
  cards: Card[];
}

export function isSampleId(value: string | null | undefined): value is SampleId {
  return value === "hk_en" || value === "cn_zh" || value === "cn_zh_photo";
}

/**
 * Static specifiers, one per fixture, so the bundler can split them: the JSON only downloads
 * when someone actually opens a sample.
 */
async function loadFixture(id: SampleId): Promise<unknown> {
  switch (id) {
    case "hk_en":
      return (await import("@/fixtures/sheets/hk_en.expected.json")).default;
    case "cn_zh":
      return (await import("@/fixtures/sheets/cn_zh.expected.json")).default;
    case "cn_zh_photo":
      return (await import("@/fixtures/sheets/cn_zh_photo.expected.json")).default;
  }
}

/**
 * The last gate before a card reaches the screen (constitution principle VI).
 *
 * The read route filters every card it streams, and those streamed cards are the authoritative
 * copy for the session. But a card rebuilt from a *stored* reading has not been through that
 * filter: `/api/read` copies its filtered bodies back onto the medicines, follow-up, diet and
 * activity fields, and cannot do so for warning signs, whose card body is symptom and action
 * joined with no inverse. So anything rebuilt with `buildCards` — a sample, a reload, coming back
 * from /ask — runs through here, and a failing body becomes the fixed template built from the
 * card's own facts. A templated body is no longer model-written, so the AI chip comes off with it.
 */
export function filterCards(cards: Card[]): Card[] {
  return cards.map((card) =>
    checkCard(card).ok
      ? card
      : { ...card, body: templateFor(card.type, card.facts ?? {}), aiGenerated: false },
  );
}

/** Loads one bundled sheet as if it had just been read, marked as a sample. */
export async function loadSampleReading(id: SampleId): Promise<SampleReading> {
  const raw = await loadFixture(id);
  const parsed = SheetReadingSchema.parse(raw);

  const reading: StoredReading = {
    ...parsed,
    dietLine: applyDietRules(parsed),
    readAt: new Date().toISOString(),
    sample: true,
  };

  return { reading, cards: filterCards(buildCards(reading)) };
}
