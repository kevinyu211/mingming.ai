/**
 * Domain schemas: the single source of truth for the shape of a SheetReading and the
 * model's structured outputs. Mirrors specs/001-discharge-sheet-agent/contracts/sheet-reading.schema.json.
 *
 * This module has NO dependency on the model SDK so that lib/rules (deterministic gates,
 * constitution principle III) can import types from here without crossing the lint boundary.
 * lib/model/schemas.ts re-exports everything for the model layer.
 */
import { z } from "zod";

/**
 * One spoken line in the three forms the app can read aloud: colloquial written Cantonese
 * (traditional), Mandarin (simplified), and plain English. All three are required — a card the
 * app cannot speak in every offered language is a half-built card.
 */
export const SpeakableSchema = z.strictObject({
  yue: z.string().describe("Colloquial written Cantonese, traditional characters"),
  cmn: z.string().describe("Mandarin, simplified characters"),
  en: z.string().describe("Plain, warm English at roughly a 12-year-old reading level"),
});
export type Speakable = z.infer<typeof SpeakableSchema>;

/** Where on the page a card came from. `quote` is verbatim and exempt from the banned-term filter. */
export const SourceReferenceSchema = z.strictObject({
  section: z.string().describe("Section heading as printed on the page"),
  lineIndex: z.number().int().min(0).nullable().describe("0-based line within the section"),
  quote: z.string().describe("Verbatim source text"),
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const WarningSignSchema = z.strictObject({
  symptom: SpeakableSchema,
  action: SpeakableSchema,
  source: SourceReferenceSchema,
});
export type WarningSign = z.infer<typeof WarningSignSchema>;

/**
 * What the PAGE says about a medicine, read off its own headings — never inferred from knowledge
 * of the drug.
 *
 * This exists because a sheet that prints a 「停用药物（出院后不再服用）」 or
 * "Medicines Stopped … (not to be taken)" block was previously indistinguishable, once typed, from
 * the discharge list: the words survived only in `spoken`, and the plan scheduled a drug the
 * hospital had withdrawn (tests/eval/stress.md, "The worst single miss"). A field is the only
 * thing that can carry that across the rules boundary, so it is required, not optional.
 *
 * Only `current` is a dose to take. `lib/rules/plan-from-reading.ts` schedules nothing else, and
 * `lib/rules/card-order.ts` flags the rest so the UI can show them as ended rather than as due.
 */
export const MedicineStatusSchema = z.enum(["current", "stopped", "changed"]);
export type MedicineStatus = z.infer<typeof MedicineStatusSchema>;

export const MedicineSchema = z.strictObject({
  name: z.string().describe("Verbatim, script untouched"),
  strength: z.string().nullable(),
  amount: z.string().nullable(),
  frequency: z
    .string()
    .nullable()
    .describe(
      "The whole printed instruction as one verbatim string, meal timing and route included; null when not printed",
    ),
  duration: z.string().nullable(),
  status: MedicineStatusSchema.describe(
    'From the page\'s own heading: "stopped" under a discontinued / not-to-be-taken heading, "changed" for a dose the stay altered and the page lists apart from the discharge list, "current" otherwise. Only "current" is scheduled.',
  ),
  spoken: SpeakableSchema,
  source: SourceReferenceSchema,
});
export type Medicine = z.infer<typeof MedicineSchema>;

export const FollowUpItemSchema = z.strictObject({
  clinic: z.string().nullable(),
  when: z.string().nullable(),
  tests: z.string().nullable(),
  spoken: SpeakableSchema,
  source: SourceReferenceSchema,
});
export type FollowUpItem = z.infer<typeof FollowUpItemSchema>;

export const TextLineSchema = z.strictObject({
  text: z.string(),
  spoken: SpeakableSchema,
  source: SourceReferenceSchema,
});
export type TextLine = z.infer<typeof TextLineSchema>;

/** As produced by the model. `recognisedType` is added by lib/rules/diet-line.ts afterwards. */
export const DietLineSchema = z.strictObject({
  raw: z.string(),
  spoken: SpeakableSchema,
  source: SourceReferenceSchema,
});
export type DietLine = z.infer<typeof DietLineSchema>;

export const DietTypeSchema = z.enum(["low_salt", "low_fat", "diabetic", "light", "other"]);
export type DietType = z.infer<typeof DietTypeSchema>;

export const DietLineWithTypeSchema = DietLineSchema.extend({
  recognisedType: DietTypeSchema,
});
export type DietLineWithType = z.infer<typeof DietLineWithTypeSchema>;

/**
 * A gap the reader admits to. Two kinds count and both land here: something the page HIDES (a
 * thumb, a fold, glare, a cut edge) and something the page shows but does not RESOLVE (a blurred
 * digit, a smudged letter, a date whose day could be read two ways). The second is why `field`
 * exists: the covered case was already handled honestly, but an ambiguous character was being
 * settled silently into a confident value, and "part of the page is hidden" never told anyone
 * which value to go and check (tests/eval/stress.md).
 */
export const UnreadableRegionSchema = z.strictObject({
  section: z.string(),
  field: z
    .string()
    .nullable()
    .describe(
      'The one field this gap costs, named as it appears in this schema ("followUp[0].when", "medicines[5].duration"), or null when a whole region is affected and no single field can be named',
    ),
  description: z.string(),
  source: SourceReferenceSchema,
});
export type UnreadableRegion = z.infer<typeof UnreadableRegionSchema>;

export const SheetTypeSchema = z.enum(["hk_en", "cn_zh", "unknown"]);
export type SheetType = z.infer<typeof SheetTypeSchema>;

/** The model's structured output for one read. */
export const SheetReadingSchema = z.strictObject({
  sheetType: SheetTypeSchema,
  warningSigns: z.array(WarningSignSchema),
  medicines: z.array(MedicineSchema),
  followUp: z.array(FollowUpItemSchema),
  dietLine: DietLineSchema.nullable(),
  activityLine: TextLineSchema.nullable(),
  hospitalContact: TextLineSchema.nullable(),
  unreadable: z.array(UnreadableRegionSchema),
});
export type SheetReading = z.infer<typeof SheetReadingSchema>;

/** What the client keeps after rules have run: recognised diet type, timestamp, sample flag. */
export const StoredReadingSchema = SheetReadingSchema.extend({
  dietLine: DietLineWithTypeSchema.nullable(),
  readAt: z.string().describe("ISO timestamp set by the client; never sent to the model"),
  sample: z.boolean().optional().describe("True when loaded from a bundled fixture"),
});
export type StoredReading = z.infer<typeof StoredReadingSchema>;

/**
 * Structured output of /api/ask's model call.
 *
 * `kind` is the whole safety boundary of this route, and it is the model's ONE job to place a
 * question in the right box (constitution IV, amended 1.1.0):
 *
 *   sheet    the answer is on a supplied card. `citedCardId` names it. The reader is being told
 *            what THEIR page says, so it must trace to a line.
 *   general  the question asked what a word or a routine practice MEANS — "what does fasting
 *            mean", "why is blood taken on an empty stomach". Answered from general knowledge,
 *            cites nothing, and the UI labels it as general so it is never mistaken for the page.
 *   none     neither. The honest, expected outcome.
 *
 * The line is action, not knowledge. A definition is `general`; anything that would change what
 * the reader DOES — a dose, a decision to go to hospital, what is normal for them — is `none`,
 * and the medicine-change and crisis gates have already refused most of it before this runs.
 */
export const AskKindSchema = z.enum(["sheet", "general", "none"]);
export type AskKind = z.infer<typeof AskKindSchema>;

export const AskResultSchema = z.strictObject({
  kind: AskKindSchema,
  citedCardId: z
    .string()
    .nullable()
    .describe('The card the answer came from. Non-null only when kind is "sheet".'),
  answer: SpeakableSchema.nullable(),
});
export type AskResult = z.infer<typeof AskResultSchema>;

/** Structured output of /api/phrase's model call. */
export const PhraseResultSchema = z.strictObject({
  spoken: SpeakableSchema,
});
export type PhraseResult = z.infer<typeof PhraseResultSchema>;

/** Card types rendered by the UI; `noWarnings` and `referral` are rule-generated. */
export const CardTypeSchema = z.enum([
  "warning",
  "medicine",
  "followUp",
  "diet",
  "activity",
  "unreadable",
  "noWarnings",
  "referral",
]);
export type CardType = z.infer<typeof CardTypeSchema>;

export const CardSchema = z.strictObject({
  id: z.string(),
  type: CardTypeSchema,
  body: SpeakableSchema,
  source: SourceReferenceSchema.nullable(),
  aiGenerated: z.boolean(),
  /** Typed facts for the phrase route, e.g. a Medicine's fields. Never contains profile data. */
  facts: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  /**
   * Set on a medicine card whose `status` is not `current`. The card is still shown — the family
   * needs to know the page names the drug and says it is finished — but it must never be rendered
   * as a dose that is due, and `draftPlan` never schedules it. Absent means an ordinary card.
   */
  stopped: z.boolean().optional(),
  /**
   * Set by `lib/server/reading-pipeline.ts` when the card's own typed fields could not be found in
   * its own `source.quote` — the two disagree, so one of them was rewritten between the page and
   * the reply. The card is kept (dropping a medicine is worse than showing a doubtful one) and
   * marked, so the UI can tell the reader this is the line to check against the paper. Absent
   * means the card agrees with the line it stands on.
   */
  unverified: z.boolean().optional(),
});
export type Card = z.infer<typeof CardSchema>;

/** Which of the three spoken forms is read aloud. Keys of `Speakable`, exactly. */
export type Dialect = "yue" | "cmn" | "en";
/** Language the question was asked in. Same three, named for the other side of the conversation. */
export type InputLanguage = "yue" | "cmn" | "en";

/**
 * JSON Schema for the model's structured output. Draft 2020-12, additionalProperties:false
 * everywhere (strict objects), every field required, nulls as explicit unions.
 */
export function sheetReadingJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SheetReadingSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}
export function askResultJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AskResultSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}
export function phraseResultJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PhraseResultSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}
