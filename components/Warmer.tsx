"use client";

/**
 * Warms the answering path while the app is open (see `app/api/warm/route.ts`).
 *
 * Fires once on mount, again whenever the tab comes back into view, and every few minutes in
 * between, so the first question on stage lands on a function and a prompt cache that are already
 * warm. Sends nothing but the request itself. Production only: the dev server and the browser
 * suite mock the model routes and count requests, and a warm-up would be noise there.
 */
import { useEffect } from "react";

const EVERY_MS = 4 * 60 * 1000;

export default function Warmer() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/warm", { method: "POST", keepalive: true }).catch(() => {
        // Warming is best effort; a failure changes nothing the reader can see.
      });
    };

    ping();
    const timer = setInterval(ping, EVERY_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  return null;
}
