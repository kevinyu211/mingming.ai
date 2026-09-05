/**
 * Reads the parts of a streamed `AskResult` that have already fully arrived.
 *
 * The answer JSON is written in schema order — `kind`, `citedCardIds`, then `answer` with its
 * three spoken forms — so by the time the reader's own language has closed its quote, two thirds
 * of the reply are still to come. This scanner lets `/api/ask` hand that one sentence to the
 * phone the moment it is complete, instead of after the other two languages have been written.
 *
 * It is a scanner, not a parser: it walks the text once, tracks string and nesting state, and
 * reports a value only when its closing quote or bracket has actually been seen. Nothing is
 * guessed from a truncated token, so a sentence reported here is byte-identical to the one the
 * validated reply will carry. It is re-run over the whole text on each delta — a reply is a few
 * kilobytes, so that costs nothing measurable.
 *
 * Pure and dependency-free, so it is testable on strings alone and safe to share with a client.
 */
import type { Dialect } from "@/lib/domain/schemas";

export interface EarlyAnswer {
  /** `kind`, once its closing quote has arrived. */
  kind: string | null;
  /** `citedCardIds`, once its closing bracket has arrived. Strings only. */
  citedCardIds: string[] | null;
  /** `answer[dialect]`, once its closing quote has arrived. */
  text: string | null;
}

interface Frame {
  kind: "object" | "array";
  /** The key the next value belongs to, in an object frame. */
  key: string | null;
  expectKey: boolean;
  start: number;
}

const EMPTY: EarlyAnswer = { kind: null, citedCardIds: null, text: null };

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
  // The text ends right after the string: it cannot yet be told from a value.
  return null;
}

export function scanEarlyAnswer(text: string, dialect: Dialect): EarlyAnswer {
  const out: EarlyAnswer = { ...EMPTY };
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
      } else if (top !== undefined) {
        const path = frames.map((frame) => frame.key);
        const value = decode(token.raw);
        if (value !== null) {
          if (frames.length === 1 && path[0] === "kind") out.kind = value;
          if (frames.length === 2 && path[0] === "answer" && path[1] === dialect) out.text = value;
        }
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
      if (closed !== undefined) {
        const parent = frames[frames.length - 1];
        if (
          closed.kind === "array" &&
          frames.length === 1 &&
          parent?.kind === "object" &&
          parent.key === "citedCardIds"
        ) {
          try {
            const value: unknown = JSON.parse(text.slice(closed.start, i + 1));
            if (Array.isArray(value)) {
              out.citedCardIds = value.filter((id): id is string => typeof id === "string");
            }
          } catch {
            // A slice that does not parse is left unreported; the final validation will say why.
          }
        }
      }
      i += 1;
      continue;
    }

    if (c === "," && top?.kind === "object") top.expectKey = true;
    i += 1;
  }

  return out;
}
