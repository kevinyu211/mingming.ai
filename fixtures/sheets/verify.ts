/**
 * T006 self-check — run with:  npx tsx fixtures/sheets/verify.ts
 *
 * Validates every *.expected.json against contracts/sheet-reading.schema.json
 * (required keys, no unknown keys on additionalProperties:false objects, enums,
 * types, oneOf), enforces the banned-term rule on every Speakable string
 * (Constitution VI), checks the fixture counts, and confirms the rendered
 * images exist at plausible sizes. Prints a pass/fail table; exit 1 on any fail.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCHEMA_PATH = path.join(
  ROOT, 'specs', '001-discharge-sheet-agent', 'contracts', 'sheet-reading.schema.json',
);

/** Banned in every model-generated (Speakable) string. Quotes are exempt. */
const BANNED = [
  '診斷', '诊断', '治療', '治疗', '處方', '处方', '治癒', '治愈',
  '能吃', '不能吃', '唔食得', '建議你', '建议你',
];
/** The English half of lib/rules/banned-terms.ts, for the `en` form. Matched case-insensitively. */
const BANNED_EN = [
  'diagnos', 'treat', 'cure', 'prescri', 'you should', 'you must',
  'can eat', 'cannot eat', 'safe to eat',
];
/** Numeric targets aimed at the person, as opposed to doses printed on the sheet. */
const TARGET_PATTERNS: Array<[string, RegExp]> = [
  ['daily quantity target', /每[天日][^。，]{0,8}[要應应需][^。，]{0,10}[克毫升卡]/],
  ['blood-pressure target', /(血壓|血压)[^。，]{0,12}\d{2,3}\s*\/\s*\d{2,3}/],
  ['control-to-number target', /(控制|保持|降到|降至)[^。，]{0,10}(血壓|血压|血糖|體重|体重)[^。，]{0,10}\d/],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- walks an arbitrary JSON schema
type Json = any;
const schema: Json = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const errors: string[] = [];
const speakables: Array<{ path: string; yue: string; cmn: string; en: string }> = [];

function deref(node: Json): Json {
  if (node && typeof node.$ref === 'string') {
    const key = node.$ref.replace('#/$defs/', '');
    const target = schema.$defs?.[key];
    if (!target) throw new Error(`unresolved $ref ${node.$ref}`);
    return { ...target, __name: key };
  }
  return node;
}

function typeOk(value: Json, t: string): boolean {
  switch (t) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'integer': return Number.isInteger(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    default: return true;
  }
}

function validate(value: Json, rawNode: Json, at: string): void {
  const node = deref(rawNode);
  if (!node) return;

  if (node.oneOf) {
    const hits = node.oneOf.filter((sub: Json) => {
      const before = errors.length;
      validate(value, sub, at);
      const ok = errors.length === before;
      errors.length = before;
      return ok;
    });
    if (hits.length !== 1) errors.push(`${at}: matched ${hits.length} of ${node.oneOf.length} oneOf branches`);
    else validate(value, hits[0], at);
    return;
  }

  if (node.type) {
    const types: string[] = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((t) => typeOk(value, t))) {
      errors.push(`${at}: expected ${types.join('|')}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }
  }
  if (node.enum && !node.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} not in enum [${node.enum.join(', ')}]`);
  }
  if (typeof value === 'number' && typeof node.minimum === 'number' && value < node.minimum) {
    errors.push(`${at}: ${value} < minimum ${node.minimum}`);
  }

  if (Array.isArray(value) && node.items) {
    value.forEach((item, i) => validate(item, node.items, `${at}[${i}]`));
    return;
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of node.required ?? []) {
      if (!(key in value)) errors.push(`${at}: missing required key "${key}"`);
    }
    if (node.additionalProperties === false && node.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in node.properties)) errors.push(`${at}: unknown key "${key}"`);
      }
    }
    for (const [key, sub] of Object.entries(node.properties ?? {})) {
      if (key in value) validate(value[key], sub, `${at}.${key}`);
    }
    if (node.__name === 'Speakable' && typeof value.yue === 'string' && typeof value.cmn === 'string') {
      speakables.push({ path: at, yue: value.yue, cmn: value.cmn, en: value.en });
    }
  }
}

/** width x height from the PNG IHDR / JPEG SOF header. */
function dims(file: string): [number, number] | null {
  const b = readFileSync(file);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      }
      i += 2 + len;
    }
  }
  return null;
}

// ----------------------------------------------------------------- run
type Row = { check: string; result: 'PASS' | 'FAIL'; detail: string };
const rows: Row[] = [];
const add = (check: string, ok: boolean, detail = '') =>
  rows.push({ check, result: ok ? 'PASS' : 'FAIL', detail });

const FILES = ['hk_en', 'cn_zh', 'cn_zh_photo'] as const;

for (const name of FILES) {
  const file = path.join(HERE, `${name}.expected.json`);
  if (!existsSync(file)) { add(`${name}.expected.json exists`, false, 'missing'); continue; }
  const data = JSON.parse(readFileSync(file, 'utf8'));

  errors.length = 0;
  speakables.length = 0;
  validate(data, schema, name);
  add(`${name}  schema (keys/enums/types)`, errors.length === 0, errors.slice(0, 4).join(' | '));

  const hits: string[] = [];
  for (const s of speakables) {
    for (const dialect of ['yue', 'cmn', 'en'] as const) {
      const text = s[dialect];
      if (typeof text !== 'string' || text.trim().length === 0) {
        hits.push(`${s.path}.${dialect}: missing or empty`);
        continue;
      }
      for (const word of BANNED) if (text.includes(word)) hits.push(`${s.path}.${dialect}: "${word}"`);
      for (const [label, re] of TARGET_PATTERNS) if (re.test(text)) hits.push(`${s.path}.${dialect}: ${label}`);
      if (dialect !== 'en') continue;
      const lower = text.toLowerCase();
      for (const word of BANNED_EN) if (lower.includes(word)) hits.push(`${s.path}.en: "${word}"`);
    }
  }
  add(`${name}  banned terms in ${speakables.length * 3} Speakable strings`, hits.length === 0, hits.slice(0, 3).join(' | '));

  add(`${name}  medicines == 3`, data.medicines?.length === 3, `got ${data.medicines?.length}`);
  add(`${name}  warningSigns == 3`, data.warningSigns?.length === 3, `got ${data.warningSigns?.length}`);

  // every source reference is complete and 0-based
  const srcs: Json[] = [];
  const walk = (v: Json) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if ('section' in v && 'lineIndex' in v && 'quote' in v) srcs.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(data);
  const badSrc = srcs.filter(
    (s) => !s.section || (s.lineIndex !== null && (!Number.isInteger(s.lineIndex) || s.lineIndex < 0)) || typeof s.quote !== 'string',
  );
  add(`${name}  ${srcs.length} sources have section + 0-based lineIndex + quote`, badSrc.length === 0,
    badSrc.slice(0, 2).map((s) => JSON.stringify(s)).join(' | '));
}

// photo-specific expectations
const photo = JSON.parse(readFileSync(path.join(HERE, 'cn_zh_photo.expected.json'), 'utf8'));
add('cn_zh_photo  activityLine is null (thumb over line 8)', photo.activityLine === null, String(photo.activityLine));
add('cn_zh_photo  unreadable names 出院医嘱',
  photo.unreadable.length === 1 && photo.unreadable[0].section === '出院医嘱' && photo.unreadable[0].description.length > 8,
  JSON.stringify(photo.unreadable[0]?.section));

// quotes must appear verbatim in the source HTML
for (const [name, html] of [['hk_en', 'hk_en.html'], ['cn_zh', 'cn_zh.html'], ['cn_zh_photo', 'cn_zh.html']] as const) {
  const src = readFileSync(path.join(HERE, html), 'utf8').replace(/&amp;/g, '&');
  const data = JSON.parse(readFileSync(path.join(HERE, `${name}.expected.json`), 'utf8'));
  const quotes: string[] = [];
  const walk = (v: Json) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.quote === 'string' && v.quote) quotes.push(v.quote);
      Object.values(v).forEach(walk);
    }
  };
  walk(data);
  const missing = [...new Set(quotes)].filter((q) => !src.includes(q));
  add(`${name}  ${new Set(quotes).size} quotes verbatim in ${html}`, missing.length === 0, missing.slice(0, 2).join(' | '));
}

// rendered images
const IMAGES: Array<[string, number, number, number]> = [
  [path.join(HERE, 'hk_en.png'), 1240, 1754, 40_000],
  [path.join(HERE, 'cn_zh.png'), 1240, 1754, 40_000],
  [path.join(HERE, 'cn_zh_photo.jpg'), 1100, 1500, 20_000],
  [path.join(HERE, 'not_a_sheet.jpg'), 1100, 1500, 10_000],
  [path.join(ROOT, 'public', 'icons', 'icon-192.png'), 192, 192, 500],
  [path.join(ROOT, 'public', 'icons', 'icon-512.png'), 512, 512, 1_000],
];
for (const [file, w, h, minBytes] of IMAGES) {
  const rel = path.relative(ROOT, file);
  if (!existsSync(file)) { add(`image ${rel}`, false, 'missing'); continue; }
  const bytes = statSync(file).size;
  const d = dims(file);
  const ok = !!d && d[0] === w && d[1] === h && bytes >= minBytes;
  add(`image ${rel}`, ok, `${d?.join('x')} ${(bytes / 1024).toFixed(0)}KB (want ${w}x${h}, >=${(minBytes / 1024).toFixed(0)}KB)`);
}

// ----------------------------------------------------------------- table
const w1 = Math.max(...rows.map((r) => r.check.length));
const line = '-'.repeat(w1 + 8 + 3);
console.log(`${'CHECK'.padEnd(w1)}  RESULT`);
console.log(line);
for (const r of rows) {
  console.log(`${r.check.padEnd(w1)}  ${r.result}${r.result === 'FAIL' && r.detail ? `  ${r.detail}` : ''}`);
}
console.log(line);
const failed = rows.filter((r) => r.result === 'FAIL').length;
console.log(`${rows.length - failed}/${rows.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
