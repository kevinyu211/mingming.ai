"use client";

/**
 * The one active sheet and the read-only history behind it, subscribed to.
 *
 * Lives under `components/home/` because 記錄 is the screen that *is* the sheet list; 跟進 imports
 * it because it follows the same single active sheet (v2 build brief §1). There is deliberately
 * only one of these: two independent readers of `lib/sheets/store.ts` could disagree about which
 * sheet is active for a frame, and the whole product rests on that never happening.
 *
 * Read after mount, never during render: `localStorage` does not exist on the server, and
 * `loadSheets()` parses a fresh object every call, which `useSyncExternalStore` would loop on.
 * `hydrated` is false for the first client paint so a screen can hold its shape instead of
 * flashing the empty state at someone who has a sheet.
 */
import { useEffect, useState } from "react";
import { loadSheets, subscribeSheets, type SheetsState } from "@/lib/sheets";

export interface SheetsSnapshot extends SheetsState {
  /** False until the stored sheets have been read on the client. */
  hydrated: boolean;
}

const EMPTY: SheetsSnapshot = { active: null, archive: [], hydrated: false };

export function useSheets(): SheetsSnapshot {
  const [snapshot, setSnapshot] = useState<SheetsSnapshot>(EMPTY);

  useEffect(() => {
    const apply = () => {
      const { active, archive } = loadSheets();
      setSnapshot({ active, archive, hydrated: true });
    };
    apply();
    return subscribeSheets(apply);
  }, []);

  return snapshot;
}
