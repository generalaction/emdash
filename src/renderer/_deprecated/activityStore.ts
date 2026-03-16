import type { AgentEvent } from '@shared/events/agentEvents';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/appEvents';
import { PROVIDER_IDS } from '@shared/providers/registry';
import { makePtyId } from '@shared/ptyId';
import { classifyActivity } from '../lib/activityClassifier';
import { BUSY_HOLD_MS, CLEAR_BUSY_MS } from '../lib/activityConstants';
import { events } from '../lib/ipc';

export type ActivityPayload = { busy: boolean; conversationId: string | null };
type Listener = (payload: ActivityPayload) => void;

class ActivityStore {
  private listeners = new Map<string, Set<Listener>>();
  private states = new Map<string, boolean>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private busySince = new Map<string, number>();
  // PTY channel subscriptions keyed by conversationId.
  // Shared across all JS subscribers to prevent N×21 classifyActivity calls.
  private convOffs = new Map<string, Array<() => void>>();
  // Maps taskId → Set<conversationId> that are currently being watched.
  private taskConvIds = new Map<string, Set<string>>();
  // ref-count per taskId
  private refCount = new Map<string, number>();

  private armTimer(taskId: string, conversationId: string | null) {
    const prev = this.timers.get(taskId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => this.setBusy(taskId, false, conversationId), CLEAR_BUSY_MS);
    this.timers.set(taskId, t);
  }

  private setBusy(taskId: string, busy: boolean, conversationId: string | null) {
    const current = this.states.get(taskId) || false;
    if (busy) {
      const prev = this.timers.get(taskId);
      if (prev) clearTimeout(prev);
      this.timers.delete(taskId);
      this.busySince.set(taskId, Date.now());
      if (!current) {
        this.states.set(taskId, true);
        this.emit(taskId, true, conversationId);
      }
      return;
    }

    // busy === false: honor hold window so spinner stays visible briefly
    const started = this.busySince.get(taskId) || 0;
    const elapsed = started ? Date.now() - started : BUSY_HOLD_MS;
    const remaining = elapsed < BUSY_HOLD_MS ? BUSY_HOLD_MS - elapsed : 0;

    const clearNow = () => {
      const prev = this.timers.get(taskId);
      if (prev) clearTimeout(prev);
      this.timers.delete(taskId);
      this.busySince.delete(taskId);
      if (this.states.get(taskId) !== false) {
        this.states.set(taskId, false);
        this.emit(taskId, false, conversationId);
      }
    };

    if (remaining > 0) {
      const prev = this.timers.get(taskId);
      if (prev) clearTimeout(prev);
      const t = setTimeout(clearNow, remaining);
      this.timers.set(taskId, t);
    } else {
      clearNow();
    }
  }

  private emit(taskId: string, busy: boolean, conversationId: string | null) {
    const ls = this.listeners.get(taskId);
    if (!ls) return;
    const payload: ActivityPayload = { busy, conversationId };
    for (const fn of ls) {
      try {
        fn(payload);
      } catch {}
    }
  }

  /**
   * Ensure PTY data/exit channels are subscribed for a given conversationId.
   * Subscribes to {prov}-conv-{conversationId} for all known providers.
   */
  private ensureConversation(taskId: string, conversationId: string): void {
    if (this.convOffs.has(conversationId)) return;

    const offs: Array<() => void> = [];
    for (const prov of PROVIDER_IDS) {
      const ptyId = makePtyId(prov, conversationId);
      offs.push(
        events.on(
          ptyDataChannel,
          (chunk) => {
            try {
              const signal = classifyActivity(prov, chunk || '');
              if (signal === 'busy') this.setBusy(taskId, true, conversationId);
              else if (signal === 'idle') this.setBusy(taskId, false, conversationId);
              else if (this.states.get(taskId)) this.armTimer(taskId, conversationId);
            } catch {}
          },
          ptyId
        ),
        events.on(
          ptyExitChannel,
          () => {
            try {
              this.setBusy(taskId, false, conversationId);
            } catch {}
          },
          ptyId
        )
      );
    }
    this.convOffs.set(conversationId, offs);
  }

  setTaskBusy(taskId: string, busy: boolean) {
    this.setBusy(taskId, busy, null);
  }

  handleAgentEvent(event: AgentEvent) {
    const taskId = event.taskId;
    if (!taskId) return;
    const conversationId = event.conversationId ?? null;

    if (event.type === 'notification') {
      const nt = event.payload.notificationType;
      if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
        this.setBusy(taskId, false, conversationId);
      }
    } else if (event.type === 'stop') {
      this.setBusy(taskId, false, conversationId);
    }
  }

  /**
   * Subscribe to busy-state changes for a task.
   * Pass all conversation IDs belonging to the task so the store can watch them.
   * The listener receives { busy, conversationId } — conversationId is which conversation
   * triggered the change (null for programmatic changes).
   */
  subscribe(taskId: string, fn: Listener, conversationIds: string[]): () => void {
    const set = this.listeners.get(taskId) || new Set<Listener>();
    set.add(fn);
    this.listeners.set(taskId, set);
    // Emit current state immediately
    fn({ busy: this.states.get(taskId) || false, conversationId: null });

    // Track which conversation IDs belong to this task and subscribe their channels
    let convSet = this.taskConvIds.get(taskId);
    if (!convSet) {
      convSet = new Set();
      this.taskConvIds.set(taskId, convSet);
    }
    for (const convId of conversationIds) {
      if (!convSet.has(convId)) {
        convSet.add(convId);
        this.ensureConversation(taskId, convId);
      }
    }

    this.refCount.set(taskId, (this.refCount.get(taskId) ?? 0) + 1);

    return () => {
      const s = this.listeners.get(taskId);
      if (s) {
        s.delete(fn);
        if (s.size === 0) this.listeners.delete(taskId);
      }
      const count = (this.refCount.get(taskId) ?? 1) - 1;
      if (count <= 0) {
        this.refCount.delete(taskId);
        // Tear down all PTY subscriptions for this task's conversations
        const convIds = this.taskConvIds.get(taskId);
        if (convIds) {
          for (const convId of convIds) {
            const offs = this.convOffs.get(convId);
            if (offs) {
              for (const off of offs) off();
              this.convOffs.delete(convId);
            }
          }
          this.taskConvIds.delete(taskId);
        }
      } else {
        this.refCount.set(taskId, count);
      }
    };
  }

  /**
   * Add a new conversation to an already-subscribed task (e.g. when a new tab is opened).
   * No-op if the task has no active subscribers.
   */
  addConversation(taskId: string, conversationId: string): void {
    const convSet = this.taskConvIds.get(taskId);
    if (!convSet) return; // no subscribers for this task
    if (convSet.has(conversationId)) return;
    convSet.add(conversationId);
    this.ensureConversation(taskId, conversationId);
  }
}

export const activityStore = new ActivityStore();
