export {
  fsWatchContract,
  watchBackendSchema,
  watchEventSchema,
  watchEventsBatchSchema,
  watchKeySchema,
  watchResyncSchema,
  type FsWatchEvent,
  type FsWatchKey,
  type FsWatchStreamEvent,
  type WatchBackendPreference,
} from './contract';
export { requireWatchReady } from './models';
export {
  gitMetadataWatchProfile,
  workspaceContentWatchIgnore,
  type GitMetadataWatchProfile,
} from './profiles';
export type {
  IWatchService,
  WatchEvent,
  WatchEventKind,
  WatchHandle,
  WatchOptions,
} from './models';

export { fsWatchWorker } from './worker';
