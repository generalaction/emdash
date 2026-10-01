import { randomUUID } from 'node:crypto';
import { cell, expose, peek } from '@emdash/wire/state';
import { sshContract } from '../api/contract';
import type { HostTrustPrompt, HostTrustRequest } from '../api/host-trust';

/** Main owns approvals. Renderer receives only public details and one-use request ids. */
export class HostTrustRequests {
  private readonly pending = cell<HostTrustRequest[]>([]);
  readonly host = expose(sshContract.hostTrust, { pending: this.pending });
  private readonly replies = new Map<string, (accepted: boolean) => void>();
  private disposed = false;

  snapshot(): HostTrustRequest[] {
    return peek(this.pending);
  }

  confirm(prompt: HostTrustPrompt, signal: AbortSignal): Promise<boolean> {
    if (this.disposed || signal.aborted) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise((resolve) => {
      const abort = () => this.respond(id, false);
      const timer = setTimeout(abort, 300_000);
      timer.unref();
      this.replies.set(id, (accepted) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pending.set(this.snapshot().filter((request) => request.id !== id));
        resolve(accepted && !signal.aborted);
      });
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set([...this.snapshot(), { id, prompt }]);
    });
  }

  respond(id: string, accepted: boolean): boolean {
    const reply = this.replies.get(id);
    if (!reply) return false;
    this.replies.delete(id);
    reply(accepted);
    return true;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const id of this.replies.keys()) this.respond(id, false);
    await this.host.dispose();
  }
}
