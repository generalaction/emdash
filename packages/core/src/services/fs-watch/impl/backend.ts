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

export interface WatchBackend {
  /** Aborts when backend-wide state is poisoned and the owning service must be replaced. */
  readonly failureSignal?: AbortSignal;
  subscribe(key: WatchKey, sink: WatchSink, scope: Scope): Promise<void>;
  dispose?(): Promise<void> | void;
}
