import type { Scope } from '@emdash/wire/util';
import type { IWatchService } from '../api';
import { nativeWatchBackend, type NativeWatchBackendOptions } from '../impl/native-backend';
import { createWatchService } from '../impl/watch-service';

export type CreateNativeWatchServiceOptions = Readonly<{
  scope?: Scope;
  graceMs?: number;
  onError?: NativeWatchBackendOptions['onError'];
  subscribe?: NativeWatchBackendOptions['subscribe'];
}>;

export function createNativeWatchService(
  options: CreateNativeWatchServiceOptions = {}
): IWatchService {
  return createWatchService({
    backend: nativeWatchBackend({ onError: options.onError, subscribe: options.subscribe }),
    scope: options.scope,
    graceMs: options.graceMs,
    onError: options.onError,
  });
}
