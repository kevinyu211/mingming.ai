/**
 * The warning signs that have already fully arrived while the model is still writing the rest.
 *
 * A one-page read spends roughly ten seconds thinking and eighteen streaming the JSON, and the
 * JSON is written in schema order: `sheetType`, then `warningSigns`, then the medicines and
 * everything after. So the red flags — the one section constitution II says must be heard first —
 * are complete in the stream around second seventeen, and were being held back until second
 * thirty-three because the route waited for the whole document to validate. This module lets
 * `/api/read` hand each warning to the phone the moment its closing brace has been seen.
 *
 * It is a scanner in the style of `lib/model/early.ts`: one walk over the text, tracking string
 * and nesting state, reporting an element only once its `}` has actually arrived and parsed. It
 * never guesses from a truncated token, so a warning reported here is byte-identical to the one
 * the validated reading will carry. It is re-run over the accumulated text on each delta until
 * the array closes, after which `push` is a no-op — the warnings are the first array, so that is
 * a few kilobytes at most.
 *
 * The safety gates are the same ones the final pass applies, in the same order, on the same card
 * (`lib/rules/card-order.ts` builds it for both): a warning whose spoken forms the banned-term
 * filter would send for repair is NOT sent early — the family hears it once, repaired, from the
 * final pass. A malformed element stops the scan rather than shifting the ones after it, because
 * the final reading will fail validation and the route retracts what was sent.
 *
 * Pure, no I/O, no logging (principle V): nothing here keeps or reports card text.
 */
import { WarningSignSchema, type Card, type WarningSign } from "@/lib/domain/schemas";
import { checkCard } from "@/lib/rules/banned-terms";
import { warningCard } from "@/lib/rules/card-order";

interface Frame {
  kind: "object" | "array";
  /** The key the next value belongs to, in an object frame. */
  key: string | null;
  expectKey: boolean;
  start: number;
}

/** Reads one JSON string token starting at the opening quote. Null when it has not closed yet. */
function readString(text: string, at: number): { raw: string; end: number } | null {
  let i = at + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return { raw: text.slice(at, i + 1), end: i };
    i += 1;
  }
  return null;
}

function decode(raw: string): string | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** True when the next non-blank character after `end` is a colon, i.e. the string was a key. */
function isKey(text: string, end: number): boolean | null {
  let i = end + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") {
      i += 1;
      continue;
    }
    return c === ":";
  }
  return null;
}

/** True when `frames` is exactly root object → `warningSigns` array. */
function inWarningSigns(frames: Frame[]): boolean {
  return (
    frames.length === 2 &&
    frames[0].kind === "object" &&
    frames[0].key === "warningSigns" &&
    frames[1].kind === "array"
  );
}

export interface EarlyScan {
  /** Every completed, schema-valid element of `warningSigns`, in order, up to the first bad one. */
  signs: WarningSign[];
  /** The array's closing bracket has arrived: nothing more can be found in later text. */
  closed: boolean;
}

/**
 * The completed elements of the top-level `warningSigns` array in a partial JSON document.
 *
 * Robust to arbitrary whitespace, strings containing braces, brackets and escaped quotes, the
 * array not yet opened, the array opened with no element closed, and any amount of text after
 * the array. Never throws: anything it cannot make sense of is simply not reported, and the final
 * validation says why.
 */
export function scanEarlyWarningsDetailed(text: string): EarlyScan {
  const out: EarlyScan = { signs: [], closed: false };
  try {
    const frames: Frame[] = [];
    let i = 0;

    while (i < text.length) {
      const c = text[i];
      const top = frames[frames.length - 1];

      if (c === '"') {
        const token = readString(text, i);
        if (token === null) return out;
        if (top?.kind === "object" && top.expectKey) {
          const key = isKey(text, token.end);
          if (key === null) return out;
          top.key = decode(token.raw);
          top.expectKey = false;
        }
        i = token.end + 1;
        continue;
      }

      if (c === "{" || c === "[") {
        frames.push({ kind: c === "{" ? "object" : "array", key: null, expectKey: c === "{", start: i });
        i += 1;
        continue;
      }

      if (c === "}" || c === "]") {
        const closed = frames.pop();
        if (closed === undefined) return out;
        if (closed.kind === "object" && inWarningSigns(frames)) {
          const parsed = WarningSignSchema.safeParse(JSON.parse(text.slice(closed.start, i + 1)));
          // A bad element would shift every index after it; stop rather than mislabel.
          if (!parsed.success) return out;
          out.signs.push(parsed.data);
        } else if (closed.kind === "array" && frames.length === 1 && frames[0].key === "warningSigns") {
          out.closed = true;
          return out;
        }
        i += 1;
        continue;
      }

      if (c === "," && top?.kind === "object") top.expectKey = true;
      i += 1;
    }
  } catch {
    // A slice that does not parse is left unreported.
  }
  return out;
}

/** `scanEarlyWarningsDetailed`, signs only. */
export function scanEarlyWarnings(text: string): WarningSign[] {
  return scanEarlyWarningsDetailed(text).signs;
}

export interface EarlyWarningTracker {
  /** Feeds one text delta; returns the cards that became sendable with it, in index order. */
  push(delta: string): Card[];
  /** Ids of every card returned so far, in the order they were returned. */
  readonly sent: readonly string[];
}

/**
 * Per-attempt state for the route: accumulates the model's text and hands back each warning card
 * at most once, in order, the moment it is complete and passes the filter. A warning the final
 * pass would repair is skipped for good — its index is consumed, never revisited — so that the
 * one the family eventually hears is the repaired one.
 */
export function earlyWarningTracker(): EarlyWarningTracker {
  let text = "";
  let next = 0;
  let closed = false;
  const sent: string[] = [];
  return {
    sent,
    push(delta: string): Card[] {
      if (closed) return [];
      text += delta;
      const scan = scanEarlyWarningsDetailed(text);
      closed = scan.closed;
      const out: Card[] = [];
      for (; next < scan.signs.length; next += 1) {
        const card = warningCard(scan.signs[next], next);
        if (!checkCard(card).ok) continue;
        sent.push(card.id);
        out.push(card);
      }
      return out;
    },
  };
}
