import { classifyActivity } from './activityClassifier';
import { CLEAR_BUSY_MS, BUSY_HOLD_MS } from './activityConstants';

type Listener = (busy: boolean) => void;

class ActivityStore {
  private listeners = new Map<string, Set<Listener>>();
  private states = new Map<string, boolean>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private busySince = new Map<string, number>();
  private subscribed = false;
  private subscribedIds = new Set<string>();

  private ensureSubscribed() {
    if (this.subscribed) return;
    this.subscribed = true;
    const api: any = (window as any).electronAPI;
    api?.onPtyActivity?.((info: { id: string; chunk?: string }) => {
      try {
        const id = String(info?.id || '');
        // Match any subscribed task id by suffix
        for (const wsId of this.subscribedIds) {
          if (!id.endsWith(wsId)) continue;
          const prov = id.includes('-main-') ? id.split('-main-')[0] || '' : '';
          const signal = classifyActivity(prov, info?.chunk || '');
          if (signal === 'busy') {
            this.setBusy(wsId, true, true);
          } else if (signal === 'idle') {
            this.setBusy(wsId, false, true);
          } else {
            // neutral: keep current but set soft clear timer
            if (this.states.get(wsId)) this.armTimer(wsId);
          }
        }
      } catch {}
    });
    api?.onPtyExitGlobal?.((info: { id: string }) => {
      try {
        const id = String(info?.id || '');
        for (const wsId of this.subscribedIds) {
          if (id.endsWith(wsId)) this.setBusy(wsId, false, true);
        }
      } catch {}
    });
  }

  private armTimer(wsId: string) {
    const prev = this.timers.get(wsId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => this.setBusy(wsId, false, true), CLEAR_BUSY_MS);
    this.timers.set(wsId, t);
  }

  private setBusy(wsId: string, busy: boolean, fromEvent = false) {
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

  subscribe(wsId: string, fn: Listener) {
    this.ensureSubscribed();
    this.subscribedIds.add(wsId);
    const set = this.listeners.get(wsId) || new Set<Listener>();
    set.add(fn);
    this.listeners.set(wsId, set);
    // emit current
    fn(this.states.get(wsId) || false);
    // Fallback: also listen directly to this task's main PTY data in case global broadcast is missing
    const offDirect: Array<() => void> = [];
    try {
      const api: any = (window as any).electronAPI;
      const providers = [
        'amp',
        'auggie',
        'charm',
        'claude',
        'cline',
        'codebuff',
        'codex',
        'continue',
        'copilot',
        'cursor',
        'droid',
        'gemini',
        'goose',
        'kilocode',
        'kimi',
        'kiro',
        'mistral',
        'opencode',
        'qwen',
        'rovo',
      ];
      for (const prov of providers) {
        const ptyId = `${prov}-main-${wsId}`;
        const off = api?.onPtyData?.(ptyId, (chunk: string) => {
          try {
            const signal = classifyActivity(prov, chunk || '');
            if (signal === 'busy') this.setBusy(wsId, true, true);
            else if (signal === 'idle') this.setBusy(wsId, false, true);
            else if (this.states.get(wsId)) this.armTimer(wsId);
          } catch {}
        });
        if (off) offDirect.push(off);
      }
    } catch {}

    return () => {
      const s = this.listeners.get(wsId);
      if (s) {
        s.delete(fn);
        if (s.size === 0) this.listeners.delete(wsId);
      }
      try {
        for (const off of offDirect) off?.();
      } catch {}
      // keep subscribedIds to avoid thrash; optional cleanup could remove when no listeners
    };
  }
}

export const activityStore = new ActivityStore();
