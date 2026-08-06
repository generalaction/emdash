import type { HostRef } from '@emdash/core/primitives/host/api';

type SweepTriggerListener = (host: HostRef) => void;

const listeners = new Set<SweepTriggerListener>();

/**
 * In-process trigger channel for the reconcile sweep (ADR 0006): the tombstone write
 * path pokes it so an entity tombstoned while its host is (or flaps back) reachable
 * sweeps immediately instead of waiting for the backstop. Module-level like
 * `appDbPokes`, so write paths never thread the sweep service through their callers.
 */
export const reconcileSweepTriggers = {
  poke(host: HostRef): void {
    for (const listener of [...listeners]) listener(host);
  },
  subscribe(listener: SweepTriggerListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
