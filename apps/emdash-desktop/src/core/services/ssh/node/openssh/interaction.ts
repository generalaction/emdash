/** Pauses acquisition budgets while a bounded, cancelable trust request awaits the user. */
export class SshInteraction {
  private count = 0;
  private readonly listeners = new Set<(waiting: boolean) => void>();

  begin(): () => void {
    this.count++;
    if (this.count === 1) this.publish();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.count--;
      if (this.count === 0) this.publish();
    };
  }

  subscribe(listener: (waiting: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.count > 0);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.count > 0);
  }
}

export function connectionDeadline(
  timeoutMs: number,
  expire: () => void,
  interaction?: SshInteraction
): () => void {
  if (timeoutMs <= 0) return () => {};
  let remaining = timeoutMs;
  let started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const update = (waiting: boolean) => {
    if (expired) return;
    if (timer) {
      clearTimeout(timer);
      remaining -= performance.now() - started;
      timer = undefined;
    }
    if (!waiting) {
      started = performance.now();
      timer = setTimeout(
        () => {
          expired = true;
          expire();
        },
        Math.max(0, remaining)
      );
    }
  };
  const unsubscribe = interaction?.subscribe(update);
  if (!interaction) update(false);
  return () => {
    unsubscribe?.();
    clearTimeout(timer);
  };
}
