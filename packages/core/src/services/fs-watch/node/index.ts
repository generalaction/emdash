import type { Scope } from '@emdash/shared/concurrency';
import type { IWatchService } from '#services/fs-watch/api';
import type { WatchOnError } from '#services/fs-watch/impl/backend';
import { nativeWatchBackend } from '#services/fs-watch/impl/native-backend';
import { createWatchService } from '#services/fs-watch/impl/watch-service';

export type CreateNativeWatchServiceOptions = Readonly<{
  scope?: Scope;
  onError?: WatchOnError;
}>;

export function createNativeWatchService(
  options: CreateNativeWatchServiceOptions = {}
): IWatchService {
  return createWatchService({
    backend: nativeWatchBackend({
      onError: options.onError,
    }),
    scope: options.scope,
    onError: options.onError,
  });
}

export { fsWatchComponent, fsWatchComponentConfigSchema } from './component';
export { fsWatchWorkerSpec, type FsWatchWorkerSpecInput } from './worker-spec';
