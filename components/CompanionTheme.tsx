"use client";

/**
 * Paints the companion tokens from the animal on this phone. Buttons stay jade; the sky, the
 * plates, and the conversation card follow 明明's body so picking 貓仔 is visible from across
 * the table, not only in Settings.
 */
import { useEffect, useSyncExternalStore } from "react";
import { applyMascotTheme } from "@/lib/mascot-theme";
import { loadState, readMascotAnimal, subscribe } from "@/lib/storage/local";

function readAnimal() {
  return readMascotAnimal(loadState());
}

export default function CompanionTheme() {
  const animal = useSyncExternalStore(subscribe, readAnimal, readAnimal);

  useEffect(() => {
    applyMascotTheme(animal);
  }, [animal]);

  return null;
}
