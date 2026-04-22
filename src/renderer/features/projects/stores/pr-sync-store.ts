import { makeAutoObservable, observable, runInAction } from 'mobx';
import { prSyncProgressChannel } from '@shared/events/prEvents';
import type { PrSyncProgress } from '@shared/pull-requests';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

export class PrSyncStore {
  readonly states = observable.map<string, PrSyncProgress>();
  private _unsub: (() => void) | null = null;

  constructor(private readonly projectId: string) {
    log.info('[PrSyncStore] created for project', projectId);
    this._unsub = events.on(prSyncProgressChannel, (progress) => {
      log.info('[PrSyncStore] received prSyncProgress event', progress);
      runInAction(() => {
        this.states.set(progress.remoteUrl, progress);
      });
    });
    makeAutoObservable(this, { states: false });
  }

  getState(remoteUrl: string): PrSyncProgress | undefined {
    return this.states.get(remoteUrl);
  }

  cancel(remoteUrl: string): void {
    void rpc.pullRequests.cancelSync(remoteUrl);
  }

  retry(): void {
    log.info('[PrSyncStore] retry triggered for project', this.projectId);
    void rpc.pullRequests.syncPullRequests(this.projectId);
  }

  isSyncing(remoteUrl: string): boolean {
    return this.states.get(remoteUrl)?.status === 'running';
  }

  clear(remoteUrl: string): void {
    this.states.delete(remoteUrl);
  }

  dispose(): void {
    this._unsub?.();
    this._unsub = null;
  }
}
