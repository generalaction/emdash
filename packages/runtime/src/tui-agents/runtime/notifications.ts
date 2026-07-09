import type { ResolvedTuiProvider } from '@emdash/core/agents/plugins';
import type { CanonicalHookEvent } from '@emdash/core/agents/plugins';
import { defaultHookEventParser } from '@emdash/core/agents/plugins/helpers';
import type { TuiNotificationState } from '@emdash/core/workspace-server';
import type { TuiNotificationsListModel, TuiSessionsListModel } from '../state/live-models';

const ATTENTION_NOTIFICATION_TYPES = new Set([
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
]);

export class TuiAgentNotifications {
  constructor(
    private readonly sessions: TuiSessionsListModel,
    private readonly notifications: TuiNotificationsListModel
  ) {}

  emitHookEvent(
    conversationId: string,
    provider: Pick<ResolvedTuiProvider, 'parseHookEvent'> | null,
    eventType: string,
    body: Record<string, unknown>
  ): void {
    const event =
      provider?.parseHookEvent?.(eventType, body) ?? defaultHookEventParser(eventType, body);
    this.applyCanonicalEvent(conversationId, event);
  }

  markInputSubmitted(
    conversationId: string,
    provider: Pick<ResolvedTuiProvider, 'hooks'> | null,
    data: string
  ): void {
    if (!data.includes('\r')) return;
    if (provider?.hooks.kind !== 'none' && provider?.hooks.supportedEvents.includes('start'))
      return;
    this.setStatus(conversationId, { status: 'working' });
  }

  resetToIdle(conversationId: string): void {
    this.setStatus(conversationId, { status: 'idle' });
  }

  clear(conversationId: string): void {
    this.notifications.states.list.produce((draft) => {
      delete draft[conversationId];
    });
  }

  private applyCanonicalEvent(conversationId: string, event: CanonicalHookEvent): void {
    if (event.kind === 'ignore') return;
    if (event.kind === 'session') {
      this.sessions.states.list.produce((draft) => {
        const session = draft[conversationId];
        if (session) session.sessionId = event.providerSessionId;
      });
      return;
    }

    if (event.type === 'start') {
      this.setStatus(conversationId, {
        status: 'working',
        title: event.title,
        message: event.message,
        lastAssistantMessage: event.lastAssistantMessage,
      });
      return;
    }

    if (event.type === 'stop') {
      this.setStatus(conversationId, {
        status: 'completed',
        title: event.title,
        message: event.message,
        lastAssistantMessage: event.lastAssistantMessage,
      });
      return;
    }

    if (event.type === 'error') {
      this.setStatus(conversationId, {
        status: 'error',
        title: event.title,
        message: event.message,
        lastAssistantMessage: event.lastAssistantMessage,
      });
      return;
    }

    const status =
      event.notificationType && ATTENTION_NOTIFICATION_TYPES.has(event.notificationType)
        ? 'awaiting-input'
        : 'idle';
    this.setStatus(conversationId, {
      status,
      notificationType: event.notificationType,
      title: event.title,
      message: event.message,
      lastAssistantMessage: event.lastAssistantMessage,
    });
  }

  private setStatus(
    conversationId: string,
    patch: Omit<Partial<TuiNotificationState>, 'conversationId' | 'at'>
  ): void {
    this.notifications.states.list.produce((draft) => {
      draft[conversationId] = {
        conversationId,
        status: patch.status ?? draft[conversationId]?.status ?? 'idle',
        notificationType: patch.notificationType,
        title: patch.title,
        message: patch.message,
        lastAssistantMessage: patch.lastAssistantMessage,
        at: Date.now(),
      };
    });
  }
}
