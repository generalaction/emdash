import {
  formatHostRef,
  hostRef,
  LOCAL_HOST_REF,
  type HostRef,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import type { Scope } from '@emdash/shared/concurrency';
import type { Hosts } from '@core/services/hosts/node/hosts';

export type HostAttachmentParticipant = {
  label: string;
  attach(host: HostRef): Promise<void> | void;
  detach(host: HostRef): Promise<void> | void;
};

type HostAttachmentRegistryLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

export type HostAttachmentRegistryOptions = {
  scope?: Scope;
  hosts: Pick<Hosts, 'onInvalidate' | 'onReady'>;
  logger?: HostAttachmentRegistryLogger;
};

/**
 * Tracks hosts whose runtime may be asserted positively and serializes converger
 * lifecycle work per host. Ordinary SSH disconnects deliberately leave attachments
 * intact: the supervisor replaces transport while Wire refreshes retained subscriptions.
 */
export class HostAttachmentRegistry {
  private readonly hosts = new Map<SerializedHostRef, HostRef>([
    [formatHostRef(LOCAL_HOST_REF), LOCAL_HOST_REF],
  ]);
  private readonly participants: HostAttachmentParticipant[] = [];
  private readonly chains = new Map<SerializedHostRef, Promise<void>>();
  private readonly unsubscribeInvalidation: () => void;
  private readonly unsubscribeReady: () => void;
  private disposed = false;

  constructor(private readonly options: HostAttachmentRegistryOptions) {
    this.unsubscribeReady = options.hosts.onReady((id) => this.attachHost(hostRef('remote', id)));
    this.unsubscribeInvalidation = options.hosts.onInvalidate(({ connectionId }) => {
      this.detachHost(hostRef('remote', connectionId));
    });
    options.scope?.add(() => this.dispose());
  }

  register(participant: HostAttachmentParticipant): () => void {
    if (this.disposed) return () => {};
    this.participants.push(participant);
    for (const host of this.hosts.values()) {
      this.enqueue(host, () => this.invoke(participant, 'attach', host));
    }
    return () => {
      const index = this.participants.indexOf(participant);
      if (index === -1) return;
      this.participants.splice(index, 1);
      for (const host of this.hosts.values()) {
        this.enqueue(host, () => this.invoke(participant, 'detach', host));
      }
    };
  }

  attachedHosts(): readonly HostRef[] {
    return [...this.hosts.values()];
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeInvalidation();
    this.unsubscribeReady();
    const hosts = [...this.hosts.values()];
    this.hosts.clear();
    for (const host of hosts) {
      this.enqueue(host, async () => {
        for (const participant of [...this.participants].reverse()) {
          await this.invoke(participant, 'detach', host);
        }
      });
    }
    await Promise.allSettled(this.chains.values());
    this.participants.length = 0;
  }

  private attachHost(host: HostRef): void {
    if (this.disposed) return;
    this.hosts.set(formatHostRef(host), host);
    const participants = [...this.participants];
    this.enqueue(host, async () => {
      for (const participant of participants) {
        await this.invoke(participant, 'attach', host);
      }
    });
  }

  private detachHost(host: HostRef): void {
    if (this.disposed) return;
    this.hosts.delete(formatHostRef(host));
    const participants = [...this.participants].reverse();
    this.enqueue(host, async () => {
      for (const participant of participants) {
        await this.invoke(participant, 'detach', host);
      }
    });
  }

  private enqueue(host: HostRef, work: () => Promise<void>): void {
    const key = formatHostRef(host);
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.chains.set(key, current);
    void current.finally(() => {
      if (this.chains.get(key) === current) this.chains.delete(key);
    });
  }

  private async invoke(
    participant: HostAttachmentParticipant,
    operation: 'attach' | 'detach',
    host: HostRef
  ): Promise<void> {
    try {
      await participant[operation](host);
    } catch (error) {
      this.options.logger?.warn('Host attachment participant failed', {
        participant: participant.label,
        operation,
        host: formatHostRef(host),
        error: String(error),
      });
    }
  }
}
