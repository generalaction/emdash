import type { Scope } from '@emdash/shared/concurrency';
import type { WatchEvent } from '#services/fs-watch/api';

export type WatchKey = {
  root: string;
  ignore: string[];
};

export type WatchSink = {
  events(events: WatchEvent[]): void;
  resync(): void;
};

export type WatchOnError = (context: string, error: unknown) => void;

export type WatchBackendStart = {
  /** Cancels only the wait for a backend-owned startup slot. */
  signal: AbortSignal;
  /** Marks the point at which the active startup deadline begins. */
  onStart: () => void;
};

export interface WatchBackend {
  subscribe(key: WatchKey, sink: WatchSink, scope: Scope, start: WatchBackendStart): Promise<void>;
  dispose?(): Promise<void> | void;
}
