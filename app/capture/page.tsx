"use client";

/**
 * `/capture` — full screen, no tab bar (brief §1). The camera, the photo picker and the review
 * grid all live in `components/Capture.tsx`; this route is the frame around them.
 *
 * The Suspense boundary is required rather than decorative: `useSearchParams` reads `?pick=1`,
 * which is how 上載相片 on 記錄 opens straight into the picker.
 */
import { Suspense } from "react";
import Capture from "@/components/Capture";

export default function CapturePage() {
  return (
    <Suspense fallback={<Booting />}>
      <Capture />
    </Suspense>
  );
}

function Booting() {
  return <div className="mx-auto w-full max-w-md flex-1 px-6 pt-4 lg:max-w-3xl" aria-hidden="true" />;
}
