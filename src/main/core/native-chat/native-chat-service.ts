import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { isAppFocused } from '@main/core/agent-hooks/notification';
import { workspaceTrustService } from '@main/core/agent-hooks/workspace-trust-service';
import { resolveProviderEnv } from '@main/core/conversations/impl/provider-env';
import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { isNativeChatProvider, type NativeChatProviderId } from '@shared/conversation-ui';
import type { Conversation } from '@shared/conversations';
import { agentEventChannel, agentSessionExitedChannel } from '@shared/events/agentEvents';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { nativeChatEventChannel, type NativeChatEvent } from '@shared/events/nativeChatEvents';
import {
  emptyNativeChatState,
  type NativeChatItem,
  type NativeChatState,
  type NativeChatAttachment,
} from '@shared/native-chat';
import { makePtyId } from '@shared/ptyId';
import { attachmentDisplayName, buildPromptWithAttachments } from './attachments';
import { buildClaudeExecCommand, isClaudeSessionId } from './claude-exec-command';
import { createClaudeStreamParser } from './claude-exec-events';
import { buildCodexExecCommand, isCodexThreadId } from './codex-exec-command';
import { isIgnorableCodexNotice, parseCodexExecLine } from './codex-exec-events';
import type { NativeChatTurnEvent } from './native-exec-events';
import { buildPiExecCommand } from './pi-exec-command';
import { createPiStreamParser } from './pi-exec-events';

const STDERR_TAIL_MAX_CHARS = 2_000;
const INTERRUPT_KILL_TIMEOUT_MS = 5_000;

/** One stateful stream parser per turn; Codex's line parser is stateless. */
function createTurnParser(
  providerId: NativeChatProviderId,
  itemKeyPrefix: string
): { parseLine(line: string): NativeChatTurnEvent[] } {
  if (providerId === 'claude') return createClaudeStreamParser(itemKeyPrefix);
  if (providerId === 'pi') return createPiStreamParser(itemKeyPrefix);
  return {
    parseLine: (line) => [parseCodexExecLine(line, itemKeyPrefix)],
  };
}

type ChatSession = {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: NativeChatProviderId;
  items: NativeChatItem[];
  itemIndexByKey: Map<string, number>;
  turnStatus: 'idle' | 'running';
  lastError: string | null;
  turnSeq: number;
  turnDurationsMs: Record<string, number>;
  threadId?: string;
  child: ChildProcess | null;
  interruptRequested: boolean;
  disposed: boolean;
};

export type StartNativeChatTurnParams = {
  conversation: Conversation;
  cwd: string;
  taskEnvVars: Record<string, string>;
  prompt: string;
  attachments?: NativeChatAttachment[];
};

/**
 * Drives conversations in native chat mode: one structured non-interactive
 * child process per turn, parsed into transcript items and streamed to the
 * renderer. Holds per-conversation transcript state in memory; the
 * provider-native thread id is persisted so both follow-up turns and a
 * fallback to the CLI terminal can resume the same provider session.
 *
 * Deliberately separate from the PTY path — terminal-mode conversations never
 * touch this service.
 */
export class NativeChatService {
  private sessions = new Map<string, ChatSession>();

  getState(conversationId: string): NativeChatState {
    const session = this.sessions.get(conversationId);
    if (!session) return emptyNativeChatState(conversationId);
    return {
      conversationId,
      items: [...session.items],
      turnStatus: session.turnStatus,
      lastError: session.lastError,
      turnDurationsMs: { ...session.turnDurationsMs },
    };
  }

  isTurnRunning(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.turnStatus === 'running';
  }

  async startTurn({
    conversation,
    cwd,
    taskEnvVars,
    prompt,
    attachments,
  }: StartNativeChatTurnParams): Promise<void> {
    const trimmed = prompt.trim();
    const attached = attachments ?? [];
    if (!trimmed && attached.length === 0) return;

    const session = this.getOrCreateSession(conversation);
    if (session.turnStatus === 'running') {
      throw new Error('The agent is already working on this conversation.');
    }
    session.turnStatus = 'running';
    session.lastError = null;
    session.interruptRequested = false;

    const providerId = session.providerId;
    let imageAttachments: NativeChatAttachment[];
    let promptAttachments: NativeChatAttachment[];
    let command: string;
    let args: string[];
    let providerConfig: ProviderCustomConfig | undefined;
    try {
      await workspaceTrustService.maybeAutoTrustLocal({
        providerId,
        cwd,
        homedir: homedir(),
        force: conversation.autoApprove === true,
      });

      // Codex takes images natively via `-i`; every other attachment (and all
      // attachments for the other providers) is referenced by path in the
      // prompt for the agent to read from disk.
      imageAttachments =
        providerId === 'codex' ? attached.filter((attachment) => attachment.kind === 'image') : [];
      promptAttachments = attached.filter((attachment) => !imageAttachments.includes(attachment));
      const agentPrompt =
        buildPromptWithAttachments(trimmed, promptAttachments) || 'Look at the attached images.';

      providerConfig = await providerOverrideSettings.getItem(providerId);
      const resumeThreadId = this.resolveResumeThreadId(session, conversation);
      ({ command, args } = this.buildTurnCommand({
        providerId,
        providerConfig,
        conversation,
        resumeThreadId,
        prompt: agentPrompt,
        images: imageAttachments.map((attachment) => attachment.path),
      }));
      if (session.disposed) throw new Error('Native chat session was disposed.');
    } catch (error) {
      if (!session.disposed) {
        session.turnStatus = 'idle';
        session.interruptRequested = false;
        session.lastError = error instanceof Error ? error.message : String(error);
      }
      throw error;
    }

    const turnSeq = ++session.turnSeq;
    const turnStartedAt = Date.now();

    this.upsertItem(session, {
      kind: 'user_message',
      key: `t${turnSeq}:user`,
      text:
        attached.length > 0
          ? `${trimmed || 'Look at the attached files.'}\n\n[Attached: ${attached
              .map(attachmentDisplayName)
              .join(', ')}]`
          : trimmed,
    });
    this.emitChatEvent(session, { type: 'turn-started' });
    this.emitAgentEvent(session, 'start');
    void touchConversation(session.conversationId, new Date().toISOString()).catch(() => {});

    // Hook env is codex-only: its session-start hook doubles as a session-id
    // backup. Claude's hooks would emit duplicate stop/notification events on
    // top of the ones this service already produces from the stream.
    const hookPort = agentHookService.getPort();
    const hook =
      providerId === 'codex' && hookPort > 0
        ? {
            port: hookPort,
            ptyId: makePtyId(providerId, session.conversationId),
            token: agentHookService.getToken(),
          }
        : undefined;
    const env = {
      ...buildAgentEnv({
        hook,
        providerVars: resolveProviderEnv(providerConfig, {
          providerId,
          autoApprove: conversation.autoApprove,
        }),
      }),
      ...taskEnvVars,
    };

    let child: ChildProcess;
    try {
      // Direct argv spawn — no shell involved, so the prompt needs no quoting.
      // stdin is ignored: these one-shot modes take the prompt as an argv
      // value and must not block waiting for piped input.
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      this.finalizeTurn(session, {
        failed: true,
        message: error instanceof Error ? error.message : String(error),
        turnSeq,
        durationMs: Date.now() - turnStartedAt,
      });
      throw error;
    }
    session.child = child;

    let stderrTail = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX_CHARS);
    });

    const turnParser = createTurnParser(providerId, `t${turnSeq}`);
    if (child.stdout) {
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        for (const event of turnParser.parseLine(line)) {
          this.handleTurnEvent(session, event);
        }
      });
    }

    child.once('error', (error) => {
      log.warn('NativeChatService: failed to spawn native chat turn', {
        conversationId: session.conversationId,
        error: String(error),
      });
      session.lastError = session.lastError ?? `Failed to start ${providerId}: ${error.message}`;
    });

    child.once('close', (code) => {
      if (session.child === child) session.child = null;
      if (session.disposed) return;
      const durationMs = Date.now() - turnStartedAt;
      if (session.interruptRequested) {
        this.upsertItem(session, {
          kind: 'system',
          key: `t${turnSeq}:interrupted`,
          text: 'Interrupted',
        });
        this.finalizeTurn(session, { failed: false, interrupted: true, turnSeq, durationMs });
        return;
      }
      if (session.lastError !== null || code !== 0) {
        const detail = stderrTail.trim().split('\n').pop() ?? '';
        const label = session.providerId;
        const message =
          session.lastError ??
          (detail
            ? `${label} exited with code ${code}: ${detail}`
            : `${label} exited with code ${code}`);
        this.finalizeTurn(session, { failed: true, message, turnSeq, durationMs });
        return;
      }
      this.finalizeTurn(session, { failed: false, turnSeq, durationMs });
    });

    telemetryService.capture('agent_run_started', {
      provider: session.providerId,
      project_id: session.projectId,
      task_id: session.taskId,
      conversation_id: session.conversationId,
    });
  }

  interrupt(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    const child = session?.child;
    if (!session || !child || session.turnStatus !== 'running') return;
    session.interruptRequested = true;
    try {
      child.kill('SIGINT');
    } catch {}
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, INTERRUPT_KILL_TIMEOUT_MS);
    child.once('close', () => clearTimeout(killTimer));
  }

  /** Kill any running turn, wait for exit, and drop in-memory transcript state. */
  async dispose(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    await this.disposeSession(session);
  }

  async disposeTask(projectId: string, taskId: string): Promise<void> {
    const sessions = [...this.sessions.values()].filter(
      (session) => session.projectId === projectId && session.taskId === taskId
    );
    await Promise.all(sessions.map((session) => this.disposeSession(session)));
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.disposeSession(session)));
  }

  private async disposeSession(session: ChatSession): Promise<void> {
    this.sessions.delete(session.conversationId);
    session.disposed = true;
    const child = session.child;
    if (!child) return;
    session.interruptRequested = true;
    await this.terminateChild(child);
    if (session.child === child) session.child = null;
  }

  private terminateChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, INTERRUPT_KILL_TIMEOUT_MS);
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve();
      };
      child.once('close', finish);
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
      }
    });
  }

  private getOrCreateSession(conversation: Conversation): ChatSession {
    const existing = this.sessions.get(conversation.id);
    if (existing) return existing;
    if (!isNativeChatProvider(conversation.providerId)) {
      throw new Error(`Native chat is not supported for provider: ${conversation.providerId}`);
    }
    const session: ChatSession = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      providerId: conversation.providerId,
      items: [],
      itemIndexByKey: new Map(),
      turnStatus: 'idle',
      lastError: null,
      turnSeq: 0,
      turnDurationsMs: {},
      child: null,
      interruptRequested: false,
      disposed: false,
    };
    this.sessions.set(conversation.id, session);
    return session;
  }

  private resolveResumeThreadId(
    session: ChatSession,
    conversation: Conversation
  ): string | undefined {
    const candidate = session.threadId ?? conversation.providerSessionId;
    if (!candidate) return undefined;
    if (session.providerId === 'codex') return isCodexThreadId(candidate) ? candidate : undefined;
    if (session.providerId === 'claude')
      return isClaudeSessionId(candidate) ? candidate : undefined;
    if (session.providerId === 'pi') return isCodexThreadId(candidate) ? candidate : undefined;
    return undefined;
  }

  private buildTurnCommand({
    providerId,
    providerConfig,
    conversation,
    resumeThreadId,
    prompt,
    images,
  }: {
    providerId: NativeChatProviderId;
    providerConfig: ProviderCustomConfig | undefined;
    conversation: Conversation;
    resumeThreadId?: string;
    prompt: string;
    images?: string[];
  }): { command: string; args: string[] } {
    if (providerId === 'claude') {
      return buildClaudeExecCommand({
        providerConfig,
        autoApprove: conversation.autoApprove,
        resumeSessionId: resumeThreadId,
        model: conversation.model,
        reasoningEffort: conversation.reasoningEffort,
        prompt,
      });
    }
    if (providerId === 'pi') {
      return buildPiExecCommand({
        providerConfig,
        sessionId: resumeThreadId ?? conversation.id,
        model: conversation.model,
        reasoningEffort: conversation.reasoningEffort,
        prompt,
      });
    }
    return buildCodexExecCommand({
      providerConfig,
      autoApprove: conversation.autoApprove,
      resumeThreadId,
      model: conversation.model,
      reasoningEffort: conversation.reasoningEffort,
      serviceTier: conversation.serviceTier,
      images,
      prompt,
    });
  }

  private handleTurnEvent(session: ChatSession, event: NativeChatTurnEvent): void {
    switch (event.type) {
      case 'thread-started':
        this.recordThreadId(session, event.threadId);
        return;
      case 'item':
        if (event.item.kind === 'error' && isIgnorableCodexNotice(event.item.message)) return;
        this.upsertItem(session, event.item);
        return;
      case 'turn-failed':
      case 'error':
        if (isIgnorableCodexNotice(event.message)) return;
        session.lastError = event.message;
        return;
      case 'turn-started':
      case 'turn-completed':
      case 'ignored':
        return;
    }
  }

  private recordThreadId(session: ChatSession, threadId: string): void {
    if (session.threadId === threadId) return;
    session.threadId = threadId;
    void setProviderSessionId(session.conversationId, threadId)
      .then((updated) => {
        if (!updated) return;
        events.emit(conversationChangedChannel, {
          conversationId: session.conversationId,
          taskId: session.taskId,
          projectId: session.projectId,
          changes: { providerSessionId: threadId },
        });
      })
      .catch((error) => {
        log.warn('NativeChatService: failed to persist thread id', {
          conversationId: session.conversationId,
          error: String(error),
        });
      });
  }

  private upsertItem(session: ChatSession, item: NativeChatItem): void {
    const existingIndex = session.itemIndexByKey.get(item.key);
    if (existingIndex === undefined) {
      session.itemIndexByKey.set(item.key, session.items.length);
      session.items.push(item);
    } else {
      session.items[existingIndex] = item;
    }
    this.emitChatEvent(session, { type: 'item-upsert', item });
  }

  private finalizeTurn(
    session: ChatSession,
    outcome: {
      failed: boolean;
      message?: string;
      interrupted?: boolean;
      turnSeq?: number;
      durationMs?: number;
    }
  ): void {
    session.turnStatus = 'idle';
    session.interruptRequested = false;
    const turnKey = outcome.turnSeq !== undefined ? `t${outcome.turnSeq}` : undefined;
    if (turnKey && outcome.durationMs !== undefined) {
      session.turnDurationsMs[turnKey] = outcome.durationMs;
    }
    if (outcome.failed) {
      session.lastError = outcome.message ?? 'Native chat turn failed';
      this.emitChatEvent(session, {
        type: 'turn-failed',
        message: session.lastError,
        turnKey,
        durationMs: outcome.durationMs,
      });
      this.emitAgentEvent(session, 'error');
      return;
    }
    session.lastError = null;
    this.emitChatEvent(session, {
      type: 'turn-completed',
      turnKey,
      durationMs: outcome.durationMs,
    });
    if (outcome.interrupted) {
      // No completion sound/badge for a user-initiated interrupt — just leave
      // the working state, same as a PTY session exit.
      events.emit(agentSessionExitedChannel, {
        conversationId: session.conversationId,
        taskId: session.taskId,
      });
      return;
    }
    this.emitAgentEvent(session, 'stop');
  }

  private emitChatEvent(session: ChatSession, event: NativeChatEvent): void {
    events.emit(nativeChatEventChannel, {
      conversationId: session.conversationId,
      taskId: session.taskId,
      projectId: session.projectId,
      event,
    });
  }

  private emitAgentEvent(session: ChatSession, type: 'start' | 'stop' | 'error'): void {
    events.emit(agentEventChannel, {
      event: {
        type,
        source: 'input',
        providerId: session.providerId,
        projectId: session.projectId,
        taskId: session.taskId,
        conversationId: session.conversationId,
        timestamp: Date.now(),
        payload: {},
      },
      appFocused: isAppFocused(),
    });
  }
}

export const nativeChatService = new NativeChatService();
