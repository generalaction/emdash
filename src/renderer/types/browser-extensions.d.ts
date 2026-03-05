// Type augmentations for browser APIs not included in the default TypeScript lib.
// These APIs exist at runtime in Chromium but are missing from @types/web.

interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleRequestOptions {
  timeout?: number;
}

interface Window {
  requestIdleCallback(
    callback: (deadline: IdleDeadline) => void,
    options?: IdleRequestOptions
  ): number;
  cancelIdleCallback(handle: number): void;
  ResizeObserver: typeof ResizeObserver;
}
