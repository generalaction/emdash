import path from 'node:path';
import type { Disposable } from '@emdash/shared/concurrency';
import type { HostFileRef } from '@primitives/path/api';
import type { IWatchService, WatchHandle, WatchEvent } from '@services/fs-watch/api';
import { nativePathFromWorkspace } from './provisioning/paths';

const WATCH_DEBOUNCE_MS = 100;

export class WorkspaceTopologyObserver implements Disposable {
  private watches = new Map<string, WatchHandle>();

  constructor(
    private readonly watcher: IWatchService | undefined,
    private readonly onInvalidate: (workspace: HostFileRef) => void
  ) {}

  watch(workspace: HostFileRef): void {
    if (!this.watcher) return;
    const root = nativePathFromWorkspace(workspace);
    if (this.watches.has(root)) return;

    const handle = this.watcher.watch(
      root,
      (events) => {
        if (events.some((event) => affectsWorkspaceTopology(root, event))) {
          this.onInvalidate(workspace);
        }
      },
      {
        ignore: ['.git/objects/**'],
        debounceMs: WATCH_DEBOUNCE_MS,
        onResync: () => this.onInvalidate(workspace),
      }
    );
    this.watches.set(root, handle);
    void handle.ready().catch(() => {
      this.watches.delete(root);
    });
  }

  async dispose(): Promise<void> {
    const handles = [...this.watches.values()];
    this.watches.clear();
    await Promise.allSettled(handles.map((handle) => handle.release()));
  }
}

function affectsWorkspaceTopology(root: string, event: WatchEvent): boolean {
  const relative = path.relative(root, event.path).replace(/\\/g, '/');
  return (
    relative === '.git' ||
    relative === '.emdash.json' ||
    relative === '.emdash/setup-stamp.json' ||
    relative.endsWith('/.emdash/setup-stamp.json')
  );
}
