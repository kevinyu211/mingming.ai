/** Shared wall-clock limits for a scan; these do not limit extracted document content. */
export const READ_PROCESSING_TIMEOUT_MS = 240_000;
export const READ_SUBMISSION_TIMEOUT_MS = 30_000;
export const READ_RESPONSE_GRACE_MS = 10_000;
export const READ_REPAIR_TIMEOUT_MS = 10_000;
export const READ_REPAIR_CONCURRENCY = 2;
export const READ_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Stages report completed transitions, never a guessed percentage of model work. */
export type ReadProgressPhase = "submitting" | "reading" | "checking";
