import { conversationEvents } from '@main/core/conversations/conversation-events';
import { resolveWorkspace } from '@main/core/projects/utils';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { lastTurnBaselineChannel } from '@shared/core/git/events';

/**
 * Tracks a per-workspace git tree snapshot captured at the start of each agent turn, so the
 * diff view can show only what the most recent turn changed (#1635).
 *
 * The baseline is the worktree state at the moment the user submitted the latest prompt,
 * captured on the provider-agnostic `conversation:input-submitted` event (fires for both ACP
 * and PTY agents). "Last turn diff" is then the diff between that snapshot and the current
 * worktree.
 *
 * In-memory on purpose: the snapshot is a dangling git tree that `git gc` could prune between
 * sessions, and the value is only meaningful for the current, most-recent turn. It resets on
 * restart and is re-captured on the next prompt.
 */
class LastTurnBaselineService {
  private readonly baselines = new Map<string, string>();
  private unsubscribeInput: (() => void) | null = null;
  private unsubscribeTeardown: (() => void) | null = null;

  initialize(): void {
    // Returns the capture promise (the hook runs it in the background); `capture` handles
    // its own errors, so it never rejects.
    this.unsubscribeInput = conversationEvents.on(
      'conversation:input-submitted',
      ({ projectId, taskId }) => this.capture(projectId, taskId)
    );
    // Drop a workspace's baseline once its task is torn down so the map does not grow.
    this.unsubscribeTeardown = taskSessionManager.hooks.on('task:torn-down', ({ workspaceId }) => {
      this.baselines.delete(workspaceId);
    });
  }

  dispose(): void {
    this.unsubscribeInput?.();
    this.unsubscribeTeardown?.();
    this.unsubscribeInput = null;
    this.unsubscribeTeardown = null;
    this.baselines.clear();
  }

  /** The tree oid snapshotted at the start of the most recent turn, if any. */
  getBaseline(workspaceId: string): string | undefined {
    return this.baselines.get(workspaceId);
  }

  private async capture(projectId: string, taskId: string): Promise<void> {
    const workspaceId = taskSessionManager.getWorkspaceId(taskId);
    if (!workspaceId) return;
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return;
    try {
      const treeOid = await workspace.gitWorktree.snapshotWorktreeTree();
      this.baselines.set(workspaceId, treeOid);
      events.emit(lastTurnBaselineChannel, { projectId, workspaceId });
    } catch (error) {
      log.warn('LastTurnBaselineService: worktree snapshot failed', {
        taskId,
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const lastTurnBaselineService = new LastTurnBaselineService();
