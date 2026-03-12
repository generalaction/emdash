import type { AgentStatusKind, AgentStatusSnapshot } from '@shared/agentStatus';
import type { AgentEvent } from '@shared/agentEvents';
import { parsePtyId } from '@shared/ptyId';
import { mapAgentEventToStatus, mapUserInputToStatus } from './providerStatusAdapters';

type Listener = (snapshot: AgentStatusSnapshot) => void;
type UnreadListener = (unread: boolean) => void;

const UNKNOWN_STATUS: AgentStatusSnapshot = {
  id: '',
  ptyId: '',
  providerId: '',
  kind: 'unknown',
  updatedAt: 0,
};

export class AgentStatusStore {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly unreadListeners = new Map<string, Set<UnreadListener>>();
  private readonly statusById = new Map<string, AgentStatusSnapshot>();
  private readonly unreadById = new Map<string, boolean>();
  private activeView: { taskId: string | null; statusId: string | null } = {
    taskId: null,
    statusId: null,
  };

  getStatus(id: string): AgentStatusSnapshot {
    return this.statusById.get(id) ?? { ...UNKNOWN_STATUS, id };
  }

  subscribe(id: string, listener: Listener): () => void {
    const listeners = this.listeners.get(id) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    listener(this.getStatus(id));

    return () => {
      const current = this.listeners.get(id);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(id);
      }
    };
  }

  getUnread(id: string): boolean {
    return this.unreadById.get(id) ?? false;
  }

  subscribeUnread(id: string, listener: UnreadListener): () => void {
    const listeners = this.unreadListeners.get(id) ?? new Set<UnreadListener>();
    listeners.add(listener);
    this.unreadListeners.set(id, listeners);
    listener(this.getUnread(id));

    return () => {
      const current = this.unreadListeners.get(id);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.unreadListeners.delete(id);
      }
    };
  }

  handleAgentEvent(event: AgentEvent): void {
    const nextKind = mapAgentEventToStatus(event);
    if (!nextKind) return;

    const parsed = parsePtyId(event.ptyId);
    const id = parsed?.suffix || event.taskId;
    if (!id) return;

    if (
      (nextKind === 'waiting' || nextKind === 'complete' || nextKind === 'error') &&
      !this.isVisibleStatusId(id)
    ) {
      this.setUnread(id, true);
    }
    this.setStatus({
      id,
      ptyId: event.ptyId,
      providerId: event.providerId,
      kind: nextKind,
      message: event.payload.message?.trim() || undefined,
    });
  }

  markUserInputSubmitted(args: { ptyId: string }): void {
    const parsed = parsePtyId(args.ptyId);
    if (!parsed) return;

    const nextKind = mapUserInputToStatus(parsed.providerId);
    if (!nextKind) return;
    this.setStatus({
      id: parsed.suffix,
      ptyId: args.ptyId,
      providerId: parsed.providerId,
      kind: nextKind,
    });
  }

  handlePtyExit(args: { ptyId: string }): void {
    const parsed = parsePtyId(args.ptyId);
    if (!parsed) return;

    const current = this.statusById.get(parsed.suffix);
    if (!current) return;
    if (current.kind === 'complete' || current.kind === 'error' || current.kind === 'idle') return;

    this.setStatus({
      id: parsed.suffix,
      ptyId: args.ptyId,
      providerId: parsed.providerId,
      kind: 'idle',
    });
  }

  markSeen(id: string): void {
    this.setUnread(id, false);
  }

  setActiveView(view: { taskId: string | null; statusId: string | null }): void {
    this.activeView = view;
  }

  private setStatus(args: {
    id: string;
    ptyId: string;
    providerId: string;
    kind: AgentStatusKind;
    message?: string;
  }): void {
    const current = this.statusById.get(args.id);
    const next: AgentStatusSnapshot = {
      id: args.id,
      ptyId: args.ptyId,
      providerId: args.providerId,
      kind: args.kind,
      updatedAt: Date.now(),
      message: args.message,
    };

    if (
      current &&
      current.kind === next.kind &&
      current.ptyId === next.ptyId &&
      current.providerId === next.providerId &&
      current.message === next.message
    ) {
      return;
    }

    this.statusById.set(args.id, next);
    const listeners = this.listeners.get(args.id);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {}
    }
  }

  private setUnread(id: string, unread: boolean): void {
    const current = this.unreadById.get(id) ?? false;
    if (current === unread) return;
    this.unreadById.set(id, unread);
    const listeners = this.unreadListeners.get(id);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(unread);
      } catch {}
    }
  }

  private isVisibleStatusId(id: string): boolean {
    return this.activeView.statusId === id;
  }
}

export const agentStatusStore = new AgentStatusStore();
