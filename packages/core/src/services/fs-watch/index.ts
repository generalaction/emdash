export {
  nativeWatchBackend,
  type NativeWatchBackendOptions,
  type WatchBackend,
  type WatchKey,
  type WatchOnError,
  type WatchSink,
} from './backend';
export {
  fsWatchContract,
  watchErrorSchema,
  watchEventSchema,
  watchEventsBatchSchema,
  watchKeySchema,
  watchResyncSchema,
  type FsWatchEvent,
  type FsWatchKey,
  type FsWatchStreamEvent,
} from './contract';
export { NativeWatch, type ParcelSubscribeFn } from './native-watch';
export { realpathOrResolve } from './paths';
export { processWatchBackend, type ProcessWatchBackendOptions } from './process-backend';
export { createFsWatchService, type CreateFsWatchServiceOptions } from './service';
export { createWatchService, type CreateWatchServiceOptions } from './watch-service';
export type { IWatchService, WatchEvent, WatchEventKind, WatchHandle, WatchOptions } from './types';
