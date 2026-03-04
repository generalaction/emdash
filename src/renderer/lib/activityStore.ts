import { classifyActivity } from './activityClassifier';
import { CLEAR_BUSY_MS, BUSY_HOLD_MS } from './activityConstants';
import { type PtyIdKind, makePtyId } from '@shared/ptyId';
import { PROVIDER_IDS } from '@shared/providers/registry';
import type { AgentEvent } from '@shared/events/agentEvents';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/appEvents';
import { events } from './rpc';

type Listener = (busy: boolean) => void;

class ActivityStore {
  private listeners = new Map<string, Set<Listener>>();
  private states = new Map<string, boolean>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private busySince = new Map<string, number>();
  // PTY subscriptions shared across all JS subscribers for a given (wsId, kind).
  // Prevents N×21 classifyActivity calls when N components watch the same workspace.
  private ptyKindOffs = new Map<string, Map<PtyIdKind, Array<() => void>>>();
  private refCount = new Map<string, number>();

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

  private ensurePtyKind(wsId: string, kind: PtyIdKind): void {
    let kindMap = this.ptyKindOffs.get(wsId);
    if (!kindMap) {
      kindMap = new Map();
      this.ptyKindOffs.set(wsId, kindMap);
    }
    if (kindMap.has(kind)) return;

    const offs: Array<() => void> = [];
    for (const prov of PROVIDER_IDS) {
      const ptyId = makePtyId(prov, kind, wsId);
      offs.push(
        events.on(
          ptyDataChannel,
          (chunk) => {
            try {
              const signal = classifyActivity(prov, chunk || '');
              if (signal === 'busy') this.setBusy(wsId, true, true);
              else if (signal === 'idle') this.setBusy(wsId, false, true);
              else if (this.states.get(wsId)) this.armTimer(wsId);
            } catch {}
          },
          ptyId
        ),
        events.on(
          ptyExitChannel,
          () => {
            try {
              this.setBusy(wsId, false, true);
            } catch {}
          },
          ptyId
        )
      );
    }
    kindMap.set(kind, offs);
  }

  setTaskBusy(wsId: string, busy: boolean) {
    this.setBusy(wsId, busy, false);
  }

  handleAgentEvent(event: AgentEvent) {
    const wsId = event.taskId;
    if (!wsId) return;

    if (event.type === 'notification') {
      const nt = event.payload.notificationType;
      // Agent is waiting for user input — mark idle
      if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
        this.setBusy(wsId, false, true);
      }
    } else if (event.type === 'stop') {
      this.setBusy(wsId, false, true);
    }
  }

  subscribe(wsId: string, fn: Listener, opts?: { kinds?: PtyIdKind[] }) {
    const set = this.listeners.get(wsId) || new Set<Listener>();
    set.add(fn);
    this.listeners.set(wsId, set);
    fn(this.states.get(wsId) || false);

    // `kinds` can be narrowed by callers for performance:
    // - task-level busy: { kinds: ['main'] } (default)
    // - conversation-level busy: { kinds: ['chat'] }
    const kinds: ReadonlyArray<PtyIdKind> = opts?.kinds?.length ? opts.kinds : ['main'];
    for (const kind of kinds) {
      this.ensurePtyKind(wsId, kind);
    }
    this.refCount.set(wsId, (this.refCount.get(wsId) ?? 0) + 1);

    return () => {
      const s = this.listeners.get(wsId);
      if (s) {
        s.delete(fn);
        if (s.size === 0) this.listeners.delete(wsId);
      }
      const count = (this.refCount.get(wsId) ?? 1) - 1;
      if (count <= 0) {
        this.refCount.delete(wsId);
        const kindMap = this.ptyKindOffs.get(wsId);
        if (kindMap) {
          for (const offs of kindMap.values()) {
            for (const off of offs) off();
          }
          this.ptyKindOffs.delete(wsId);
        }
      } else {
        this.refCount.set(wsId, count);
      }
    };
  }
}

export const activityStore = new ActivityStore();
