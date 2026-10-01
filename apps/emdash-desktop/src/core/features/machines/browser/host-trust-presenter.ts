import type { HostTrustPrompt, HostTrustRequest } from '@core/services/ssh/api/host-trust';

/** One modal at a time; pending snapshots fence late results from canceled generations. */
export class HostTrustPresenter {
  private requests: HostTrustRequest[] = [];
  private readonly shown = new Set<string>();
  private active?: { id: string; controller: AbortController };
  private disposed = false;

  constructor(
    private readonly show: (prompt: HostTrustPrompt, signal: AbortSignal) => Promise<boolean>,
    private readonly respond: (id: string, accepted: boolean) => Promise<boolean>
  ) {}

  update(requests: HostTrustRequest[]): void {
    this.requests = requests;
    for (const id of this.shown)
      if (!requests.some((request) => request.id === id)) this.shown.delete(id);
    if (this.active && !requests.some((request) => request.id === this.active?.id))
      this.active.controller.abort();
    this.presentNext();
  }

  dispose(): void {
    this.disposed = true;
    if (this.active) {
      this.active.controller.abort();
      void this.respond(this.active.id, false).catch(() => {});
    }
  }

  private presentNext(): void {
    if (this.disposed || this.active) return;
    const request = this.requests.find(({ id }) => !this.shown.has(id));
    if (!request) return;
    this.shown.add(request.id);
    const controller = new AbortController();
    this.active = { id: request.id, controller };
    void (async () => {
      const accepted = await this.show(request.prompt, controller.signal).catch(() => false);
      if (!controller.signal.aborted) await this.respond(request.id, accepted);
    })()
      .catch(() => {})
      .finally(() => {
        this.active = undefined;
        this.presentNext();
      });
  }
}
