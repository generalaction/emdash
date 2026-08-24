import type { Clock } from '@emdash/shared/scheduling';
import { produce } from '@emdash/wire/state';
import type { SessionState, SessionSummary } from '#runtimes/acp/api';
import type { SessionCell } from '#runtimes/acp/node/session/cell';
import type { SessionsListModel } from '#runtimes/acp/node/state/live-models';
import type { ActivityFields } from '#services/session-lifecycle/api';
import type { AcpStartInput } from './types';

export type SessionSummaryState = {
  lifecycle: SessionState['lifecycle'];
  isGenerating: boolean;
  backgroundAgentCount: number;
  pendingPermissions?: SessionState['pendingPermissions'];
  queuedPrompts?: SessionState['queuedPrompts'];
  pendingPermissionCount?: number;
  queuedPromptCount?: number;
  suspended?: true;
};

export class SessionsListProjector {
  constructor(
    readonly model: SessionsListModel,
    private readonly clock: Clock,
    private readonly activity: (conversationId: string) => ActivityFields
  ) {}

  upsert(input: AcpStartInput, cell: SessionCell | null, state: SessionSummaryState): void {
    const summary: Omit<SessionSummary, 'updatedAt'> = {
      conversationId: input.conversationId,
      providerId: input.providerId,
      cwd: input.cwd,
      lifecycle: state.lifecycle,
      ...(state.suspended ? { suspended: true as const } : {}),
      isGenerating: state.isGenerating,
      lastStopReason: cell?.sessionState.lastStopReason ?? null,
      lastTurnErrored: cell?.sessionState.lastTurnErrored ?? false,
      pendingPermissionCount: state.pendingPermissionCount ?? state.pendingPermissions?.length ?? 0,
      backgroundAgentCount: state.backgroundAgentCount,
      queuedPromptCount: state.queuedPromptCount ?? state.queuedPrompts?.length ?? 0,
      title: cell?.transcript.title ?? null,
    };
    const activity = this.activity(input.conversationId);
    if (activity.lastInputAt !== null) summary.lastInputAt = activity.lastInputAt;
    if (activity.lastOutputAt !== null) summary.lastOutputAt = activity.lastOutputAt;
    this.model.states.list.update((previous) => {
      const current = previous[input.conversationId];
      if (current && sessionSummaryEquals(current, summary)) return previous;
      return produce(previous, (draft) => {
        draft[input.conversationId] = { ...summary, updatedAt: this.clock.now() };
      });
    });
  }

  suspend(input: AcpStartInput): void {
    this.upsert(input, null, {
      lifecycle: 'closed',
      suspended: true,
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });
  }

  remove(conversationId: string): void {
    this.model.states.list.update((previous) => {
      if (!(conversationId in previous)) return previous;
      return produce(previous, (draft) => {
        delete draft[conversationId];
      });
    });
  }

  syncActivity(conversationId: string, activity: ActivityFields): void {
    this.model.states.list.update((previous) => {
      const current = previous[conversationId];
      if (!current) return previous;
      const lastInputAt = activity.lastInputAt ?? current.lastInputAt;
      const lastOutputAt = activity.lastOutputAt ?? current.lastOutputAt;
      if (current.lastInputAt === lastInputAt && current.lastOutputAt === lastOutputAt) {
        return previous;
      }
      return produce(previous, (draft) => {
        const next = draft[conversationId];
        if (!next) return;
        if (activity.lastInputAt !== null) next.lastInputAt = activity.lastInputAt;
        if (activity.lastOutputAt !== null) next.lastOutputAt = activity.lastOutputAt;
        next.updatedAt = this.clock.now();
      });
    });
  }
}

function sessionSummaryEquals(
  current: SessionSummary,
  candidate: Omit<SessionSummary, 'updatedAt'>
): boolean {
  return (
    current.conversationId === candidate.conversationId &&
    current.providerId === candidate.providerId &&
    current.cwd === candidate.cwd &&
    current.lifecycle === candidate.lifecycle &&
    current.suspended === candidate.suspended &&
    current.isGenerating === candidate.isGenerating &&
    current.lastStopReason === candidate.lastStopReason &&
    current.lastTurnErrored === candidate.lastTurnErrored &&
    current.pendingPermissionCount === candidate.pendingPermissionCount &&
    current.backgroundAgentCount === candidate.backgroundAgentCount &&
    current.queuedPromptCount === candidate.queuedPromptCount &&
    current.title === candidate.title &&
    current.lastInputAt === candidate.lastInputAt &&
    current.lastOutputAt === candidate.lastOutputAt
  );
}
