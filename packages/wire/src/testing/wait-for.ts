export type WaitForOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  message?: string;
};

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: WaitForOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1000;
  const intervalMs = options.intervalMs ?? 1;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(options.message ?? `Timed out waiting for condition after ${timeoutMs}ms`);
}
