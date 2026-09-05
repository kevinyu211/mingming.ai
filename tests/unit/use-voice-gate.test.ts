/**
 * A spoken line ends when BOTH the typing chain and the clip have finished. The bug this pins:
 * `onDone` used to fire on the typing timer alone, so a clip longer than its typing was cut off
 * by the next line's `say` — every medicine on the demo sheet, on a real phone.
 */
import { describe, expect, it, vi } from "vitest";
import { AUDIO_WAIT_CAP_MS, doneGate } from "@/components/chat/useVoice";

describe("doneGate", () => {
  it("waits for the clip when the typing finishes first", () => {
    const onDone = vi.fn();
    const gate = doneGate(onDone);
    gate.typed();
    expect(onDone).not.toHaveBeenCalled();
    gate.audio(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ heard: true });
  });

  it("waits for the typing when the clip finishes first", () => {
    const onDone = vi.fn();
    const gate = doneGate(onDone);
    gate.audio(true);
    expect(onDone).not.toHaveBeenCalled();
    gate.typed();
    expect(onDone).toHaveBeenCalledWith({ heard: true });
  });

  it("reports a silent line as not heard, and still ends it", () => {
    const onDone = vi.fn();
    const gate = doneGate(onDone);
    gate.audio(false);
    gate.typed();
    expect(onDone).toHaveBeenCalledWith({ heard: false });
  });

  it("fires exactly once, and the first audio verdict wins over the safety cap", () => {
    const onDone = vi.fn();
    const gate = doneGate(onDone);
    gate.typed();
    gate.audio(true);
    gate.audio(false); // the cap firing late
    gate.typed();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ heard: true });
  });

  it("keeps a cap that is long enough for any clip and short enough to notice", () => {
    expect(AUDIO_WAIT_CAP_MS).toBeGreaterThanOrEqual(30_000);
    expect(AUDIO_WAIT_CAP_MS).toBeLessThanOrEqual(60_000);
  });
});
