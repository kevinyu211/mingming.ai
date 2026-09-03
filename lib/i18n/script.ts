/**
 * Traditional <-> simplified conversion for on-screen text.
 *
 * The dialect decides the default script (Cantonese reads traditional, Mandarin reads
 * simplified) and the user can flip it. Conversion is display-only: verbatim quotes from the
 * sheet keep whatever the page printed, so never run a SourceReference.quote through this.
 */
import * as OpenCC from "opencc-js";
import type { Dialect } from "@/lib/domain/schemas";
import type { Script } from "@/lib/storage/local";

export type { Script };

type Convert = (text: string) => string;

// Building an OpenCC converter walks the full dictionary, so build each direction at most once.
let toHant: Convert | null = null;
let toHans: Convert | null = null;

function hantConverter(): Convert {
  toHant ??= OpenCC.Converter({ from: "cn", to: "hk" });
  return toHant;
}

function hansConverter(): Convert {
  toHans ??= OpenCC.Converter({ from: "hk", to: "cn" });
  return toHans;
}

/**
 * Converts display text into the requested script. Text already in the target script is
 * left alone by OpenCC, so this is safe to call on mixed or already-converted strings.
 * Latin text, numbers and punctuation pass through untouched.
 */
export function toScript(text: string, target: Script): string {
  if (!text) return text;
  return target === "hant" ? hantConverter()(text) : hansConverter()(text);
}

/** Cantonese reads traditional characters, Mandarin reads simplified (data-model, Profile). */
export function scriptForDialect(dialect: Dialect): Script {
  return dialect === "yue" ? "hant" : "hans";
}

/** The written form a script belongs to, for `lang` attributes. */
export function langForScript(script: Script): string {
  return script === "hant" ? "zh-HK" : "zh-CN";
}
