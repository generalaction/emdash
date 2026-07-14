export class RootWatchError extends Error {
  constructor(
    message: string,
    readonly cause: unknown
  ) {
    super(message);
    this.name = 'RootWatchError';
  }
}

export class RootWatchAttachError extends RootWatchError {
  constructor(cause: unknown) {
    super('File-search watcher could not be created for the root', cause);
    this.name = 'RootWatchAttachError';
  }
}

export class RootWatchReadyError extends RootWatchError {
  constructor(cause: unknown) {
    super('File-search watcher could not attach to the root', cause);
    this.name = 'RootWatchReadyError';
  }
}
