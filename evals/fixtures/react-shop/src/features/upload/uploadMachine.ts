export type UploadState = "idle" | "uploading" | "processing" | "done" | "failed";
export type UploadEvent = "START" | "UPLOADED" | "PROCESSED" | "FAIL" | "RESET";

const transitions: Record<UploadState, Partial<Record<UploadEvent, UploadState>>> = {
  idle: { START: "uploading" },
  uploading: { UPLOADED: "processing", FAIL: "failed" },
  processing: { PROCESSED: "done", FAIL: "failed" },
  done: { RESET: "idle" },
  failed: { RESET: "idle", START: "uploading" },
};

export function transition(current: UploadState, event: UploadEvent): UploadState {
  const next = transitions[current][event];
  if (!next) {
    throw new Error(`Illegal upload transition: ${current} + ${event}`);
  }
  return next;
}
