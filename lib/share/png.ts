/**
 * Draws the discharge card as a PNG, on the device, with the canvas the browser already has.
 *
 * No library and no network: the bytes never leave the phone until the reader hands them to the
 * share sheet. Fonts are the system's own (PingFang on iOS, Noto Sans CJK on Android) — the same
 * faces the app renders with — so the card looks like the app that made it.
 *
 * Client only. The layout is measured as it is drawn: the canvas is sized to the text it holds,
 * with a minimum height so a short card still reads as a card.
 */
import type { ShareCardData } from "@/lib/share/card";

export const CARD_WIDTH = 1080;
const MIN_HEIGHT = 1350;
const PAD = 72;
const INK = "#131313";
const MUTED = "#68686d";
const HAIRLINE = "#e3e2e7";
const FONT =
  '-apple-system, "SF Pro Text", "PingFang HK", "PingFang SC", "Hiragino Sans", "Noto Sans CJK HK", "Noto Sans CJK SC", "Microsoft JhengHei", sans-serif';

type Ctx = CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, weight: number) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Latin runs stay whole where they can; CJK breaks per character, which is how it wraps in print. */
function tokens(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9.,/%°+:-]*|\s+|[^\sA-Za-z0-9]/g) ?? [];
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens(text)) {
    const candidate = line + token;
    if (ctx.measureText(candidate).width <= maxWidth || line.length === 0) {
      line = candidate;
    } else {
      lines.push(line.trimEnd());
      line = token.trimStart();
    }
  }
  if (line.trim().length > 0) lines.push(line.trimEnd());
  return lines;
}

interface Op {
  height: number;
  draw: (ctx: Ctx, y: number) => void;
}

function paragraph(
  ctx: Ctx,
  text: string,
  opts: { size: number; weight: number; colour: string; x: number; maxWidth: number; lineHeight?: number; after?: number },
): Op {
  font(ctx, opts.size, opts.weight);
  const lines = wrap(ctx, text, opts.maxWidth);
  const lh = opts.lineHeight ?? Math.round(opts.size * 1.4);
  return {
    height: lines.length * lh + (opts.after ?? 0),
    draw: (c, y) => {
      font(c, opts.size, opts.weight);
      c.fillStyle = opts.colour;
      c.textBaseline = "top";
      lines.forEach((line, i) => c.fillText(line, opts.x, y + i * lh));
    },
  };
}

function gap(height: number): Op {
  return { height, draw: () => {} };
}

function rule(): Op {
  return {
    height: 1 + 40,
    draw: (c, y) => {
      c.fillStyle = HAIRLINE;
      c.fillRect(PAD, y + 20, CARD_WIDTH - PAD * 2, 2);
    },
  };
}

function numbered(ctx: Ctx, n: number, text: string): Op {
  const x = PAD + 64;
  const body = paragraph(ctx, text, { size: 34, weight: 400, colour: INK, x, maxWidth: CARD_WIDTH - x - PAD, lineHeight: 48, after: 18 });
  return {
    height: Math.max(body.height, 48 + 18),
    draw: (c, y) => {
      c.strokeStyle = INK;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(PAD + 22, y + 24, 20, 0, Math.PI * 2);
      c.stroke();
      font(c, 22, 700);
      c.fillStyle = INK;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(n), PAD + 22, y + 25);
      c.textAlign = "left";
      body.draw(c, y);
    },
  };
}

function bullet(ctx: Ctx, text: string): Op {
  const x = PAD + 40;
  const body = paragraph(ctx, text, { size: 32, weight: 400, colour: INK, x, maxWidth: CARD_WIDTH - x - PAD, lineHeight: 46, after: 14 });
  return {
    height: body.height,
    draw: (c, y) => {
      c.fillStyle = INK;
      c.beginPath();
      c.arc(PAD + 12, y + 22, 6, 0, Math.PI * 2);
      c.fill();
      body.draw(c, y);
    },
  };
}

function pill(ctx: Ctx, text: string): Op {
  font(ctx, 26, 600);
  const w = ctx.measureText(text).width + 56;
  return {
    height: 52 + 20,
    draw: (c, y) => {
      c.fillStyle = "#ebebeb";
      c.beginPath();
      c.roundRect(PAD, y, w, 52, 26);
      c.fill();
      font(c, 26, 600);
      c.fillStyle = INK;
      c.textBaseline = "middle";
      c.fillText(text, PAD + 28, y + 27);
    },
  };
}

/** Lays the card out, then draws it. Returns a PNG blob. */
export async function renderShareCardPng(data: ShareCardData): Promise<Blob> {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("canvas unavailable");
  const width = CARD_WIDTH - PAD * 2;

  const ops: Op[] = [];
  ops.push(paragraph(measure, data.eyebrow, { size: 26, weight: 500, colour: MUTED, x: PAD, maxWidth: width, after: 14 }));
  ops.push(paragraph(measure, data.title, { size: 60, weight: 700, colour: INK, x: PAD, maxWidth: width, lineHeight: 72, after: 8 }));
  if (data.meta) ops.push(paragraph(measure, data.meta, { size: 30, weight: 400, colour: MUTED, x: PAD, maxWidth: width, after: 8 }));
  ops.push(rule());

  if (data.summary) {
    ops.push(paragraph(measure, data.summaryTitle, { size: 30, weight: 700, colour: INK, x: PAD, maxWidth: width, after: 12 }));
    ops.push(paragraph(measure, data.summary, { size: 36, weight: 500, colour: INK, x: PAD, maxWidth: width, lineHeight: 52, after: 8 }));
    ops.push(rule());
  }

  if (data.warnings.length > 0) {
    ops.push(paragraph(measure, data.warningsTitle, { size: 30, weight: 700, colour: INK, x: PAD, maxWidth: width, after: 20 }));
    data.warnings.forEach((line, i) => ops.push(numbered(measure, i + 1, line)));
    if (data.warningsMore) ops.push(paragraph(measure, data.warningsMore, { size: 28, weight: 400, colour: MUTED, x: PAD + 64, maxWidth: width - 64, after: 8 }));
    ops.push(rule());
  }

  if (data.medicines.length > 0) {
    ops.push(paragraph(measure, data.medicinesTitle, { size: 30, weight: 700, colour: INK, x: PAD, maxWidth: width, after: 20 }));
    for (const medicine of data.medicines) {
      ops.push(paragraph(measure, medicine.name, { size: 36, weight: 600, colour: INK, x: PAD, maxWidth: width, after: 4 }));
      ops.push(paragraph(measure, medicine.printed, { size: 30, weight: 400, colour: MUTED, x: PAD, maxWidth: width, after: 22 }));
    }
    if (data.medicinesMore) ops.push(paragraph(measure, data.medicinesMore, { size: 28, weight: 400, colour: MUTED, x: PAD, maxWidth: width, after: 8 }));
    ops.push(rule());
  }

  if (data.visit) {
    ops.push(paragraph(measure, data.visitTitle, { size: 30, weight: 700, colour: INK, x: PAD, maxWidth: width, after: 12 }));
    ops.push(paragraph(measure, data.visit, { size: 34, weight: 400, colour: INK, x: PAD, maxWidth: width, after: 8 }));
    ops.push(rule());
  }

  if (data.notes.length > 0) {
    ops.push(paragraph(measure, data.notesTitle, { size: 30, weight: 700, colour: INK, x: PAD, maxWidth: width, after: 16 }));
    for (const note of data.notes) ops.push(bullet(measure, note));
    ops.push(rule());
  }

  ops.push(pill(measure, data.aiLine));
  ops.push(paragraph(measure, data.footer, { size: 26, weight: 400, colour: MUTED, x: PAD, maxWidth: width, after: 14 }));
  ops.push(paragraph(measure, data.disclaimer, { size: 24, weight: 400, colour: MUTED, x: PAD, maxWidth: width, lineHeight: 34 }));
  ops.push(gap(PAD));

  const height = Math.max(MIN_HEIGHT, PAD + ops.reduce((sum, op) => sum + op.height, 0));

  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_WIDTH, height);
  // A hairline card edge, so the image reads as a card when it lands on a white chat background.
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, CARD_WIDTH - 4, height - 4);

  let y = PAD;
  for (const op of ops) {
    op.draw(ctx, y);
    y += op.height;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png");
  });
}
