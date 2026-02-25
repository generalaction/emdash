import { classifyActivity, sampleActivityChunk } from './activityClassifier';
import { CLEAR_BUSY_MS, BUSY_HOLD_MS } from './activityConstants';
import { type PtyIdKind, parsePtyId, makePtyId } from '@shared/ptyId';
import { PROVIDER_IDS } from '@shared/providers/registry';

type Listener = (busy: boolean) => void;
type DirectSubscription = {
  refCount: number;
  offData: Array<() => void>;
  offExit: Array<() => void>;
};

class ActivityStore {
  private listeners = new Map<string, Set<Listener>>();
  private states = new Map<string, boolean>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private busySince = new Map<string, number>();
  private subscribed = false;
  private subscribedIds = new Set<string>();
  private directSubscriptions = new Map<string, DirectSubscription>();
  private hasGlobalActivityFeed = false;

  private normalizeKinds(kinds?: PtyIdKind[]): PtyIdKind[] {
    if (!kinds?.length) return ['main'];
    const uniqueKinds = Array.from(new Set(kinds));
    uniqueKinds.sort();
    return uniqueKinds as PtyIdKind[];
  }

  private makeDirectSubscriptionKey(wsId: string, kinds: readonly PtyIdKind[]): string {
    return `${wsId}|${kinds.join(',')}`;
  }

  private resolveSubscribedTaskFromPtyId(id: string): { wsId: string; provider: string } | null {
    const parsed = parsePtyId(id);
    if (parsed && this.subscribedIds.has(parsed.suffix)) {
      return { wsId: parsed.suffix, provider: parsed.providerId };
    }

    for (const wsId of this.subscribedIds) {
      if (!id.endsWith(wsId)) continue;
      return { wsId, provider: parsed?.providerId || '' };
    }
    return null;
  }

  private applyClassifiedSignal(wsId: string, provider: string, chunk: string) {
    const sampledChunk = sampleActivityChunk((chunk || '').toString());
    const signal = classifyActivity(provider, sampledChunk);
    if (signal === 'busy') {
      this.setBusy(wsId, true, true);
    } else if (signal === 'idle') {
      this.setBusy(wsId, false, true);
    } else if (this.states.get(wsId)) {
      // neutral: keep current but set soft clear timer
      this.armTimer(wsId);
    }
  }

  private ensureSubscribed() {
    if (this.subscribed) return;
    this.subscribed = true;
    const api: any = (window as any).electronAPI;
    const offActivity = api?.onPtyActivity?.((info: { id: string; chunk?: string }) => {
      try {
        const id = String(info?.id || '');
        const matched = this.resolveSubscribedTaskFromPtyId(id);
        if (!matched) return;
        this.applyClassifiedSignal(matched.wsId, matched.provider, info?.chunk || '');
      } catch {}
    });
    const offExit = api?.onPtyExitGlobal?.((info: { id: string }) => {
      try {
        const id = String(info?.id || '');
        const matched = this.resolveSubscribedTaskFromPtyId(id);
        if (!matched) return;
        this.setBusy(matched.wsId, false, true);
      } catch {}
    });

    const hasActivityFeed = typeof offActivity === 'function';
    const hasExitFeed = typeof offExit === 'function';
    this.hasGlobalActivityFeed = hasActivityFeed && hasExitFeed;

    // If only one channel is available, disable it and rely on direct fallback
    // so busy/idle transitions stay consistent.
    if (!this.hasGlobalActivityFeed) {
      try {
        offActivity?.();
      } catch {}
      try {
        offExit?.();
      } catch {}
    }
  }

  private armTimer(wsId: string) {
    const prev = this.timers.get(wsId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => this.setBusy(wsId, false, true), CLEAR_BUSY_MS);
    this.timers.set(wsId, t);
  }

  private setBusy(wsId: string, busy: boolean, _fromEvent = false) {
    const current = this.states.get(wsId) || false;
    // If setting busy: clear timers and record start
    if (busy) {
      const prev = this.timers.get(wsId);
      if (prev) clearTimeout(prev);
      this.timers.delete(wsId);
      this.busySince.set(wsId, Date.now());
      if (!current) {
        this.states.set(wsId, true);
        this.emit(wsId, true);
      }
      return;
    }

    // busy === false: honor hold window so spinner is visible
    const started = this.busySince.get(wsId) || 0;
    const elapsed = started ? Date.now() - started : BUSY_HOLD_MS;
    const remaining = elapsed < BUSY_HOLD_MS ? BUSY_HOLD_MS - elapsed : 0;

    const clearNow = () => {
      const prev = this.timers.get(wsId);
      if (prev) clearTimeout(prev);
      this.timers.delete(wsId);
      this.busySince.delete(wsId);
      if (this.states.get(wsId) !== false) {
        this.states.set(wsId, false);
        this.emit(wsId, false);
      }
    };

    if (remaining > 0) {
      const prev = this.timers.get(wsId);
      if (prev) clearTimeout(prev);
      const t = setTimeout(clearNow, remaining);
      this.timers.set(wsId, t);
    } else {
      clearNow();
    }
  }

  private emit(wsId: string, busy: boolean) {
    const ls = this.listeners.get(wsId);
    if (!ls) return;
    for (const fn of ls) {
      try {
        fn(busy);
      } catch {}
    }
  }

  setTaskBusy(wsId: string, busy: boolean) {
    this.setBusy(wsId, busy, false);
  }

  private retainDirectSubscription(wsId: string, kinds: readonly PtyIdKind[]): string {
    const key = this.makeDirectSubscriptionKey(wsId, kinds);
    const existing = this.directSubscriptions.get(key);
    if (existing) {
      existing.refCount += 1;
      return key;
    }

    const offData: Array<() => void> = [];
    const offExit: Array<() => void> = [];

    try {
      const api: any = (window as any).electronAPI;
      for (const prov of PROVIDER_IDS) {
        for (const kind of kinds) {
          const ptyId = makePtyId(prov, kind, wsId);
          const offChunk = api?.onPtyData?.(ptyId, (chunk: string) => {
            try {
              this.applyClassifiedSignal(wsId, prov, chunk || '');
            } catch {}
          });
          if (offChunk) offData.push(offChunk);

          const offPtyExit = api?.onPtyExit?.(ptyId, () => {
            try {
              this.setBusy(wsId, false, true);
            } catch {}
          });
          if (offPtyExit) offExit.push(offPtyExit);
        }
      }
    } catch {}

    this.directSubscriptions.set(key, { refCount: 1, offData, offExit });
    return key;
  }

  private releaseDirectSubscription(key: string) {
    const existing = this.directSubscriptions.get(key);
    if (!existing) return;

    existing.refCount -= 1;
    if (existing.refCount > 0) return;

    try {
      for (const off of existing.offData) off?.();
      for (const off of existing.offExit) off?.();
    } catch {}
    this.directSubscriptions.delete(key);
  }

  subscribe(wsId: string, fn: Listener, opts?: { kinds?: PtyIdKind[] }) {
    this.ensureSubscribed();
    this.subscribedIds.add(wsId);
    const set = this.listeners.get(wsId) || new Set<Listener>();
    set.add(fn);
    this.listeners.set(wsId, set);
    // emit current
    fn(this.states.get(wsId) || false);

    // Fallback: also listen directly to PTY data in case global broadcast is missing.
    // `kinds` can be narrowed by callers for performance:
    // - task-level busy: { kinds: ['main'] } (default)
    // - conversation-level busy: { kinds: ['chat'] }
    const kinds = this.normalizeKinds(opts?.kinds);
    const directSubscriptionKey = this.hasGlobalActivityFeed
      ? null
      : this.retainDirectSubscription(wsId, kinds);

    return () => {
      if (directSubscriptionKey) this.releaseDirectSubscription(directSubscriptionKey);

      const listenersForTask = this.listeners.get(wsId);
      if (listenersForTask) {
        listenersForTask.delete(fn);
        if (listenersForTask.size === 0) {
          this.listeners.delete(wsId);
          this.subscribedIds.delete(wsId);

          const pendingTimer = this.timers.get(wsId);
          if (pendingTimer) clearTimeout(pendingTimer);
          this.timers.delete(wsId);
          this.busySince.delete(wsId);
          this.states.delete(wsId);
        }
      }
    };
  }
}

export const activityStore = new ActivityStore();
