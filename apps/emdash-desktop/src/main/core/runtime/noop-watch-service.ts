import type { IFileWatchService, RawFileEvent, WatchHandle } from '@emdash/shared/fs';

export class NoopWatchService implements IFileWatchService {
  watch(
    _root: string,
    _onEvents: (events: RawFileEvent[]) => void,
    _options?: Parameters<IFileWatchService['watch']>[2]
  ): WatchHandle {
    return {
      ready: async () => {},
      release: () => {},
    };
  }

  async dispose(): Promise<void> {}
}
