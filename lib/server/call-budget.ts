import { ModelCancelledError, ModelTimeoutError } from "@/lib/model/client";

export function abortFailure(signal: AbortSignal): ModelCancelledError | ModelTimeoutError {
  return signal.reason instanceof ModelTimeoutError ? signal.reason : new ModelCancelledError();
}

/** A timeout aborts the actual transport as well as settling our awaiting worker. */
export function callBudget(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent ? abortFailure(parent) : new ModelCancelledError());
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (parent?.aborted) onAbort();
  else {
    parent?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => controller.abort(new ModelTimeoutError()), Math.max(0, timeoutMs));
  }
  return {
    signal: controller.signal,
    cancel: () => controller.abort(new ModelCancelledError()),
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

/** Also bounds adapters/test doubles that fail to settle when their signal aborts. */
export function withinSignal<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(abortFailure(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortFailure(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    const clean = () => signal.removeEventListener("abort", onAbort);
    try {
      Promise.resolve(call()).then(
        (value) => {
          clean();
          if (signal.aborted) reject(abortFailure(signal));
          else resolve(value);
        },
        (error: unknown) => { clean(); reject(signal.aborted ? abortFailure(signal) : error); },
      );
    } catch (error) {
      clean();
      reject(error);
    }
    // The abort listener is once-only, including when an adapter remains pending forever.
  });
}
