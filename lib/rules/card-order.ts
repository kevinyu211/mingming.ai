/**
 * T010 — the card builder and the fixed card order (FR-002, constitution principles II and IV).
 *
 * Red flags first is a property of this array, not of the model: `buildCards` reads the named
 * fields of a reading and emits cards strictly in `CARD_ORDER`, whatever order the model wrote
 * them in. When no warning signs are printed, one rule-generated `noWarnings` card takes the
 * first slot instead — the red-flag slot is never empty.
 *
 * Every card carries its `SourceReference` (principle IV). The only cards without one are the two
 * rule-generated kinds, `noWarnings` and `referral`, which quote nothing off the page.
 */
import type { Card, CardType, SheetReading, Speakable, StoredReading } from "@/lib/domain/schemas";

/** The fixed order. Not configurable. `noWarnings` rides in the `warning` slot. */
export const CARD_ORDER: CardType[] = [
  "warning",
  "medicine",
  "followUp",
  "diet",
  "activity",
  "unreadable",
];

/**
 * Sort key for a card type. `noWarnings` shares the `warning` slot; `referral` (crisis resources,
 * built elsewhere) sorts ahead of everything because it replaces the content rather than joining
 * it.
 */
function rank(type: CardType): number {
  if (type === "referral") return -1;
  if (type === "noWarnings") return CARD_ORDER.indexOf("warning");
  return CARD_ORDER.indexOf(type);
}

/** The one hard-coded body: the sheet printed no warning signs. */
const NO_WARNINGS_BODY: Speakable = {
  yue: "張紙冇印警號。如果覺得唔妥，打返醫院或者去急症室。",
  cmn: "这张纸没有印警示症状。如果觉得不舒服，打回医院或者去急诊。",
  en: "This sheet doesn't print any warning signs. If something feels wrong, ring the hospital or go to A&E.",
};

/**
 * Joins a symptom and the action the sheet asks for into one spoken sentence.
 *
 * A full stop between the two halves ("如果胸口痛。就即刻返急症室") reads as two broken fragments
 * and a voice pauses in the wrong place, so a sentence-ending mark on the symptom is replaced by a
 * comma. A clause mark the writer chose (、；：) is left alone.
 *
 * `separator` is the comma of the language being joined: "，" for the two Chinese forms, ", " for
 * English, where a full-width comma would look like a typo on screen and stall a voice.
 */
function joinWarning(symptom: string, action: string, separator = "，"): string {
  const s = symptom.trim();
  const a = action.trim();
  if (!a) return s;
  if (!s) return a;
  if (a.includes(s)) return a;
  const stem = s.replace(/[。．.!！?？]+$/, "");
  const sep = /[，,、；;：:]$/.test(stem) ? "" : separator;
  return `${stem}${sep}${a}`;
}

function unreadableBody(section: string, description: string): Speakable {
  const s = section.trim();
  const d = description.trim();
  return {
    yue: d ? `呢部分讀唔到：${s}。${d}` : `呢部分讀唔到：${s}。`,
    cmn: d ? `这部分读不到：${s}。${d}` : `这部分读不到：${s}。`,
    en: d
      ? `This part couldn't be read: ${s}. ${d.charAt(0).toUpperCase()}${d.slice(1)}`
      : `This part couldn't be read: ${s}.`,
  };
}

/**
 * Builds the displayable cards for a reading, strictly in `CARD_ORDER`. Ids are stable for the
 * same reading (type plus index), so the UI and `/api/ask` citations agree across renders.
 *
 * A reading whose `sheetType` is `unknown` produces no cards at all (FR-006): the app declines
 * rather than summarising something that is not a discharge sheet.
 */
export function buildCards(reading: SheetReading | StoredReading): Card[] {
  if (reading.sheetType === "unknown") return [];

  const cards: Card[] = [];

  if (reading.warningSigns.length === 0) {
    const contact = reading.hospitalContact;
    const contactText = contact?.text.trim() ?? "";
    cards.push({
      id: "no-warnings",
      type: "noWarnings",
      body: {
        yue: contactText ? `${NO_WARNINGS_BODY.yue} ${contactText}` : NO_WARNINGS_BODY.yue,
        cmn: contactText ? `${NO_WARNINGS_BODY.cmn} ${contactText}` : NO_WARNINGS_BODY.cmn,
        en: contactText ? `${NO_WARNINGS_BODY.en} ${contactText}` : NO_WARNINGS_BODY.en,
      },
      source: contact?.source ?? null,
      aiGenerated: false,
    });
  } else {
    reading.warningSigns.forEach((sign, i) => {
      cards.push({
        id: `warning-${i}`,
        type: "warning",
        body: {
          yue: joinWarning(sign.symptom.yue, sign.action.yue),
          cmn: joinWarning(sign.symptom.cmn, sign.action.cmn),
          en: joinWarning(sign.symptom.en, sign.action.en, ", "),
        },
        source: sign.source,
        aiGenerated: true,
        // A warning card's facts are the model's own phrasing, not printed page text, so the
        // English template needs its own copy: an English frame around a Cantonese clause is not
        // a sentence anybody can read aloud.
        facts: {
          symptom: sign.symptom.yue,
          action: sign.action.yue,
          symptomEn: sign.symptom.en,
          actionEn: sign.action.en,
        },
      });
    });
  }

  reading.medicines.forEach((m, i) => {
    const card: Card = {
      id: `medicine-${i}`,
      type: "medicine",
      body: m.spoken,
      source: m.source,
      aiGenerated: true,
      facts: {
        name: m.name,
        strength: m.strength,
        amount: m.amount,
        frequency: m.frequency,
        duration: m.duration,
        // Carried into `facts` as well as onto the card, because `facts` is what the phrase
        // repair prompt and the fixed templates are given: a re-worded stopped medicine has to
        // still be able to say that the page stopped it.
        status: m.status,
      },
    };
    // A medicine the page has stopped or changed is still shown — a family that never hears the
    // drug named cannot know it has been withdrawn — but it is flagged, so the UI can render it
    // as ended rather than as due, and `draftPlan` schedules nothing that carries this flag.
    if (m.status !== "current") card.stopped = true;
    cards.push(card);
  });

  reading.followUp.forEach((f, i) => {
    cards.push({
      id: `followup-${i}`,
      type: "followUp",
      body: f.spoken,
      source: f.source,
      aiGenerated: true,
      facts: { clinic: f.clinic, when: f.when, tests: f.tests },
    });
  });

  const diet = reading.dietLine;
  if (diet) {
    cards.push({
      id: "diet",
      type: "diet",
      body: diet.spoken,
      source: diet.source,
      aiGenerated: true,
      facts: {
        raw: diet.raw,
        // Present once lib/rules/diet-line.ts has run over the reading.
        recognisedType: "recognisedType" in diet ? diet.recognisedType : null,
      },
    });
  }

  if (reading.activityLine) {
    cards.push({
      id: "activity",
      type: "activity",
      body: reading.activityLine.spoken,
      source: reading.activityLine.source,
      aiGenerated: true,
      facts: { text: reading.activityLine.text },
    });
  }

  reading.unreadable.forEach((u, i) => {
    cards.push({
      id: `unreadable-${i}`,
      type: "unreadable",
      body: unreadableBody(u.section, u.description),
      source: u.source,
      // The wording is a rule template; only a non-empty description came from the model.
      aiGenerated: u.description.trim().length > 0,
      // `field` names the one value the gap costs ("followUp[0].when"). It stays out of the body:
      // the body is rule-written text that must carry no digits at all, and a field path has them.
      facts: { section: u.section, field: u.field, description: u.description },
    });
  });

  return cards.sort((a, b) => rank(a.type) - rank(b.type));
}

/** Card headings, traditional for Cantonese output and simplified for Mandarin. */
const CARD_TITLES: Record<CardType, { hant: string; hans: string }> = {
  warning: { hant: "警號", hans: "警示" },
  noWarnings: { hant: "警號", hans: "警示" },
  medicine: { hant: "藥", hans: "药" },
  followUp: { hant: "覆診", hans: "复诊" },
  diet: { hant: "飲食", hans: "饮食" },
  activity: { hant: "活動", hans: "活动" },
  unreadable: { hant: "讀唔到", hans: "读不到" },
  referral: { hant: "資源", hans: "资源" },
};

export function cardTitle(type: CardType, script: "hant" | "hans"): string {
  return CARD_TITLES[type][script];
}
