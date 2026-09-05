import type { MascotAnimal } from "@/lib/storage/local";

/**
 * Each animal wears a colour of its own. Jade stays on the real buttons (拍張紙, 明白, 食咗) —
 * those ratios are measured. The companion plate, the conversation card, and the sky wash are
 * what make 貓仔 and 兔仔 look like different companions rather than the same sticker on jade.
 *
 * `--muted` on every `card` clears 4.5:1. `--ink` on every `card` and `plate` is well above.
 */
export const ANIMAL_THEME: Record<
  MascotAnimal,
  { plate: string; card: string; ink: string; wash: string }
> = {
  cat: {
    plate: "#F6D7C4",
    card: "#FBF1EA",
    ink: "#8B3A1F",
    wash: "#D47648",
  },
  panda: {
    plate: "#E9F4F0",
    card: "#E9F4F0",
    ink: "#14705A",
    wash: "#1A7D63",
  },
  puppy: {
    plate: "#F3E4B5",
    card: "#F9F3E0",
    ink: "#6B4B03",
    wash: "#C49630",
  },
  rabbit: {
    plate: "#E6D9F0",
    card: "#F4EEF8",
    ink: "#5C3D7A",
    wash: "#8C6EB0",
  },
};

export const DEFAULT_THEME = ANIMAL_THEME.panda;

export function applyMascotTheme(animal: MascotAnimal, root: HTMLElement = document.documentElement) {
  const theme = ANIMAL_THEME[animal];
  root.style.setProperty("--companion-plate", theme.plate);
  root.style.setProperty("--companion-card", theme.card);
  root.style.setProperty("--companion-ink", theme.ink);
  root.style.setProperty("--companion-wash", theme.wash);
}
