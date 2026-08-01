import { makeAutoObservable, runInAction } from 'mobx';
import { getAppSettingValueSnapshot } from '@renderer/features/settings/app-settings-client';
import type { TabResource } from '@renderer/features/tabs/core/tab-provider';
import type { LoopAuthoringPort, LoopTabEvent, LoopTabSnapshot } from './loop-authoring-port';

export type LoopTabResourceState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: LoopTabSnapshot }
  | { kind: 'error'; message: string };

export type LoopTabActionState =
  | { kind: 'idle' }
  | { kind: 'pending'; action: 'pause' | 'resume' | 'retry' }
  | { kind: 'error'; action: 'pause' | 'resume' | 'retry'; message: string };

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'The Loop request failed';
}

export class LoopTabResource implements TabResource {
  state: LoopTabResourceState = { kind: 'idle' };
  action: LoopTabActionState = { kind: 'idle' };
  loading: Promise<void> | undefined;

  private unsubscribe: (() => void) | undefined;
  private activated = false;
  private enabled = false;
  private disposed = false;
  private eventVersion = 0;
  private loadGeneration = 0;

  constructor(
    readonly loopId: string,
    private readonly port: LoopAuthoringPort
  ) {
    makeAutoObservable<this, 'port' | 'unsubscribe' | 'disposed'>(this, {
      port: false,
      unsubscribe: false,
      disposed: false,
      loading: false,
    });
    this.enabled = getAppSettingValueSnapshot('experiments')?.loops === true;
  }

  onActivate(): void {
    if (!this.enabled || this.activated || this.disposed) return;
    this.activated = true;
    this.loading = this.load();
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.onActivate();
      return;
    }
    this.activated = false;
    this.eventVersion += 1;
    this.loadGeneration += 1;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.state = { kind: 'idle' };
    this.action = { kind: 'idle' };
  }

  load(): Promise<void> {
    if (!this.enabled || this.disposed) return Promise.resolve();
    this.ensureSubscribed();
    const versionAtStart = this.eventVersion;
    const generation = ++this.loadGeneration;
    this.state = { kind: 'loading' };

    const request = this.port
      .loadLoop(this.loopId)
      .then((snapshot) => {
        if (
          this.disposed ||
          generation !== this.loadGeneration ||
          this.eventVersion !== versionAtStart
        ) {
          return;
        }
        runInAction(() => {
          this.state = { kind: 'ready', snapshot };
        });
      })
      .catch((error: unknown) => {
        if (
          this.disposed ||
          generation !== this.loadGeneration ||
          this.eventVersion !== versionAtStart
        ) {
          return;
        }
        runInAction(() => {
          this.state = { kind: 'error', message: messageFromUnknown(error) };
        });
      });
    this.loading = request;
    return request;
  }

  pause(): Promise<void> {
    return this.runAction('pause', () => this.port.pauseLoop(this.loopId));
  }

  resume(): Promise<void> {
    return this.runAction('resume', () => this.port.resumeLoop(this.loopId));
  }

  retryPhase(phaseId: string): Promise<void> {
    return this.runAction('retry', () => this.port.retryPhase(this.loopId, phaseId));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventVersion += 1;
    this.loadGeneration += 1;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private ensureSubscribed(): void {
    if (this.unsubscribe || this.disposed) return;
    this.unsubscribe = this.port.subscribeToLoop(this.loopId, (event) => {
      this.applyEvent(event);
    });
  }

  private applyEvent(event: LoopTabEvent): void {
    if (this.disposed) return;
    this.eventVersion += 1;
    if (event.type === 'snapshot') {
      this.state = { kind: 'ready', snapshot: event.snapshot };
      return;
    }
    this.state = { kind: 'error', message: event.message };
  }

  private async runAction(
    action: 'pause' | 'resume' | 'retry',
    request: () => Promise<LoopTabSnapshot>
  ): Promise<void> {
    if (this.disposed || this.action.kind === 'pending') return;
    const versionAtStart = this.eventVersion;
    this.action = { kind: 'pending', action };
    try {
      const snapshot = await request();
      if (this.disposed) return;
      runInAction(() => {
        if (this.eventVersion === versionAtStart) {
          this.eventVersion += 1;
          this.state = { kind: 'ready', snapshot };
        }
        this.action = { kind: 'idle' };
      });
    } catch (error) {
      if (this.disposed) return;
      const verb = action === 'retry' ? 'retry the phase' : `${action} the Loop`;
      runInAction(() => {
        if (this.eventVersion !== versionAtStart) {
          this.action = { kind: 'idle' };
          return;
        }
        this.action = {
          kind: 'error',
          action,
          message: `Could not ${verb}: ${messageFromUnknown(error)}`,
        };
      });
    }
  }
}
