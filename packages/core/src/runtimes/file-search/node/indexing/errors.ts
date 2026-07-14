export class RootWatchReadyError extends Error {
  constructor(readonly cause: unknown) {
    super('File-search watcher could not attach to the root');
    this.name = 'RootWatchReadyError';
  }
}
