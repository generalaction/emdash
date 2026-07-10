import type { Scope } from '@emdash/wire/util';
import { NativeWatch, type ParcelSubscribeFn } from './native-watch';
import type { WatchEvent } from './types';

export type WatchKey = {
  root: string;
  ignore: string[];
};

export type WatchSink = {
  events(events: WatchEvent[]): void;
  resync(): void;
};

export type WatchOnError = (context: string, error: unknown) => void;

export interface WatchBackend {
  subscribe(key: WatchKey, sink: WatchSink, scope: Scope): Promise<void>;
  dispose?(): Promise<void> | void;
}

export type NativeWatchBackendOptions = {
  onError?: WatchOnError;
  subscribe?: ParcelSubscribeFn;
};

export function nativeWatchBackend(options: NativeWatchBackendOptions = {}): WatchBackend {
  const onError = options.onError ?? (() => {});

  return {
    async subscribe(key, sink, scope) {
      const native = new NativeWatch(
        key.root,
        key.ignore,
        sink.events,
        sink.resync,
        onError,
        options.subscribe
      );
      scope.add(() => native.dispose());
      await native.ready();
    },
  };
}
