import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import type { AcpPermissionOption, AcpSessionEvent, AcpSessionUpdate } from '@shared/acp';
import { getProvider } from '@shared/agent-provider-registry';
import { parseConversationConfig, serializeConversationConfig } from '@shared/conversation-config';
import type { Conversation } from '@shared/conversations';
import { acpSessionEventChannel } from '@shared/events/acpEvents';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { initializeAcpConnection } from './client';
import { resolveAcpCommand } from './command';
import { AcpDiagnosticsBuffer } from './diagnostics';
import { AcpJsonRpcTransport } from './json-rpc-transport';
import { isJsonObject, safeJsonStringify, type JsonRpcId, type JsonRpcRequest } from './types';

const START_TIMEOUT_MS = 15_000;
const PROMPT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const PERMISSION_DETAIL_LIMIT = 2_000;
const EVENT_HISTORY_LIMIT = 200;

type ActiveAcpSession = {
  conversation: Conversation;
  child: ChildProcessWithoutNullStreams;
  transport: AcpJsonRpcTransport;
  acpSessionId: string;
  pendingPermissions: Map<string, PendingPermission>;
};

type AcpSessionEventPayload = AcpSessionEvent extends infer T
  ? T extends { projectId: string; taskId: string; conversationId: string }
    ? Omit<T, 'projectId' | 'taskId' | 'conversationId'>
    : never
  : never;

type PendingPermission = {
  rpcId: JsonRpcId;
  options: AcpPermissionOption[];
};

export type StartLocalAcpSessionParams = {
  conversation: Conversation;
  cwd: string;
  initialPrompt?: string;
  shellProfile: ResolvedShellProfile;
  taskEnvVars?: Record<string, string>;
};

export class AcpSessionService {
  private sessions = new Map<string, ActiveAcpSession>();
  private eventHistory = new Map<string, AcpSessionEvent[]>();
  private eventSequences = new Map<string, number>();

  async startLocalSession({
    conversation,
    cwd,
    initialPrompt,
    shellProfile,
    taskEnvVars = {},
  }: StartLocalAcpSessionParams): Promise<void> {
    if (this.sessions.has(conversation.id)) return;

    this.emit(conversation, { type: 'status', status: 'starting' });
    const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
    const provider = getProvider(conversation.providerId);
    if (provider?.supportsAcp !== true) {
      throw new Error(`Provider does not support ACP: ${conversation.providerId}`);
    }
    const { command, args } = resolveAcpCommand(conversation.providerId, providerConfig);
    const providerEnv = providerConfig?.env ?? {};
    const child = spawn(command, args, {
      cwd,
      env: {
        ...buildAgentEnv({ providerVars: providerEnv, shellProfile }),
        ...taskEnvVars,
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const transport = new AcpJsonRpcTransport({
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      diagnostics: new AcpDiagnosticsBuffer(),
    });
    const session: Omit<ActiveAcpSession, 'acpSessionId'> & { acpSessionId?: string } = {
      conversation,
      child,
      transport,
      pendingPermissions: new Map(),
    };

    transport.onNotification((notification) => {
      if (notification.method !== 'session/update' || !isJsonObject(notification.params)) return;
      const sessionId = notification.params.sessionId;
      const update = notification.params.update;
      if (sessionId !== session.acpSessionId || !isAcpSessionUpdate(update)) return;
      this.emit(conversation, { type: 'update', update });
    });
    transport.onRequest((request) => {
      this.handleClientRequest(session as ActiveAcpSession, request);
    });

    child.on('error', (error) => {
      this.emit(conversation, { type: 'status', status: 'error', message: error.message });
    });
    const childError = new Promise<never>((_, reject) => {
      child.once('error', reject);
    });
    child.on('close', () => {
      this.cancelPendingPermissions(session as ActiveAcpSession);
      this.sessions.delete(conversation.id);
      this.emit(conversation, { type: 'status', status: 'exited' });
    });

    transport.start();

    try {
      const initialized = await Promise.race([
        initializeAcpConnection({
          transport,
          timeoutMs: START_TIMEOUT_MS,
        }),
        childError,
      ]);
      const acpSessionId = await Promise.race([
        this.establishSession({
          transport,
          conversation,
          cwd,
          canLoadSession: initialized.agentCapabilities?.loadSession === true,
          canResumeSession:
            initialized.agentCapabilities?.sessionCapabilities?.resume !== undefined,
        }),
        childError,
      ]);
      session.acpSessionId = acpSessionId;
      this.sessions.set(conversation.id, session as ActiveAcpSession);
      await this.saveAcpSessionId(conversation, acpSessionId);
      this.emit(conversation, {
        type: 'session',
        acpSessionId,
        agentInfo: initialized.agentInfo,
        agentCapabilities: initialized.agentCapabilities,
      });
      this.emit(conversation, { type: 'status', status: 'ready' });
      if (initialPrompt?.trim()) {
        await this.sendPrompt(conversation.id, initialPrompt);
      }
    } catch (error) {
      transport.dispose();
      child.kill();
      const message = error instanceof Error ? error.message : String(error);
      this.emit(conversation, { type: 'status', status: 'error', message });
      this.emit(conversation, { type: 'diagnostic', message: transport.diagnostics.summary() });
      throw error;
    }
  }

  async sendPrompt(conversationId: string, prompt: string): Promise<void> {
    const session = this.requireSession(conversationId);
    const text = prompt.trim();
    if (!text) return;
    this.emit(session.conversation, { type: 'status', status: 'running' });
    try {
      await session.transport.request(
        'session/prompt',
        {
          sessionId: session.acpSessionId,
          prompt: [{ type: 'text', text }],
        },
        { timeoutMs: PROMPT_TIMEOUT_MS }
      );
      this.emit(session.conversation, { type: 'status', status: 'idle' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit(session.conversation, { type: 'status', status: 'error', message });
      throw error;
    }
  }

  async cancel(conversationId: string): Promise<void> {
    const session = this.requireSession(conversationId);
    this.cancelPendingPermissions(session);
    session.transport.notify('session/cancel', { sessionId: session.acpSessionId });
    this.emit(session.conversation, { type: 'status', status: 'cancelled' });
  }

  respondPermission(conversationId: string, requestId: string, optionId: string): void {
    const session = this.requireSession(conversationId);
    const pending = session.pendingPermissions.get(requestId);
    if (!pending) throw new Error('ACP permission request not found');
    if (!pending.options.some((option) => option.optionId === optionId)) {
      throw new Error('ACP permission option not found');
    }
    session.pendingPermissions.delete(requestId);
    session.transport.respond(pending.rpcId, {
      outcome: { outcome: 'selected', optionId },
    });
    this.emit(session.conversation, {
      type: 'permission_resolved',
      requestId,
      outcome: 'selected',
    });
  }

  getDiagnostics(conversationId: string): string {
    return this.sessions.get(conversationId)?.transport.diagnostics.summary() ?? '';
  }

  getEvents(conversationId: string): AcpSessionEvent[] {
    return [...(this.eventHistory.get(conversationId) ?? [])];
  }

  stop(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    this.cancelPendingPermissions(session);
    session.transport.dispose();
    session.child.kill();
    this.sessions.delete(conversationId);
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  private handleClientRequest(session: ActiveAcpSession, request: JsonRpcRequest): void {
    if (request.method !== 'session/request_permission' || !isJsonObject(request.params)) {
      session.transport.respondError(request.id, {
        code: -32601,
        message: `Unsupported ACP client method: ${request.method}`,
      });
      return;
    }

    const options = parsePermissionOptions(request.params.options);
    const requestId = `${String(request.id)}`;
    const pending = { rpcId: request.id, options };
    session.pendingPermissions.set(requestId, pending);

    if (session.conversation.autoApprove === true) {
      const allowOption = options.find((option) => option.kind.startsWith('allow_'));
      if (allowOption) {
        this.respondPermission(session.conversation.id, requestId, allowOption.optionId);
        return;
      }
    }

    const toolCall = isJsonObject(request.params.toolCall) ? request.params.toolCall : {};
    this.emit(session.conversation, {
      type: 'permission_request',
      request: {
        requestId,
        toolCallId: typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : undefined,
        title: typeof toolCall.title === 'string' ? toolCall.title : undefined,
        kind: typeof toolCall.kind === 'string' ? toolCall.kind : undefined,
        options,
        details: boundedDetails(toolCall),
      },
    });
  }

  private cancelPendingPermissions(session: ActiveAcpSession): void {
    for (const [requestId, pending] of session.pendingPermissions) {
      session.transport.respond(pending.rpcId, { outcome: { outcome: 'cancelled' } });
      this.emit(session.conversation, {
        type: 'permission_resolved',
        requestId,
        outcome: 'cancelled',
      });
    }
    session.pendingPermissions.clear();
  }

  private async saveAcpSessionId(
    conversation: Conversation,
    providerSessionId: string
  ): Promise<void> {
    const { db } = await import('@main/db/client');
    const [row] = await db
      .select({ config: conversations.config })
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
      .limit(1);
    if (!row) return;
    const config = parseConversationConfig(row.config);
    await db
      .update(conversations)
      .set({
        config: serializeConversationConfig({ ...config, providerSessionId }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(conversations.id, conversation.id));
    events.emit(conversationChangedChannel, {
      conversationId: conversation.id,
      taskId: conversation.taskId,
      projectId: conversation.projectId,
      changes: { providerSessionId },
    });
  }

  private async establishSession({
    transport,
    conversation,
    cwd,
    canLoadSession,
    canResumeSession,
  }: {
    transport: AcpJsonRpcTransport;
    conversation: Conversation;
    cwd: string;
    canLoadSession: boolean;
    canResumeSession: boolean;
  }): Promise<string> {
    const existingSessionId = conversation.resume ? conversation.providerSessionId : undefined;
    if (existingSessionId && canResumeSession) {
      await transport.request(
        'session/resume',
        { sessionId: existingSessionId, cwd, mcpServers: [] },
        { timeoutMs: START_TIMEOUT_MS }
      );
      return existingSessionId;
    }
    if (existingSessionId && canLoadSession) {
      await transport.request(
        'session/load',
        { sessionId: existingSessionId, cwd, mcpServers: [] },
        { timeoutMs: START_TIMEOUT_MS }
      );
      return existingSessionId;
    }

    const newSessionResult = await transport.request(
      'session/new',
      { cwd, mcpServers: [] },
      { timeoutMs: START_TIMEOUT_MS }
    );
    if (!isJsonObject(newSessionResult) || typeof newSessionResult.sessionId !== 'string') {
      throw new Error('ACP session/new returned an invalid session id');
    }
    return newSessionResult.sessionId;
  }

  private requireSession(conversationId: string): ActiveAcpSession {
    const session = this.sessions.get(conversationId);
    if (!session) throw new Error('ACP session is not running');
    return session;
  }

  private emit(conversation: Conversation, event: AcpSessionEventPayload): void {
    const sequence = (this.eventSequences.get(conversation.id) ?? 0) + 1;
    this.eventSequences.set(conversation.id, sequence);
    const fullEvent = {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      sequence,
      ...event,
    } as AcpSessionEvent;
    const history = [...(this.eventHistory.get(conversation.id) ?? []), fullEvent];
    this.eventHistory.set(conversation.id, history.slice(-EVENT_HISTORY_LIMIT));
    events.emit(acpSessionEventChannel, fullEvent);
  }
}

function isAcpSessionUpdate(value: unknown): value is AcpSessionUpdate {
  return isJsonObject(value) && typeof value.sessionUpdate === 'string';
}

function parsePermissionOptions(value: unknown): AcpPermissionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isJsonObject(item)) return [];
    const { optionId, name, kind } = item;
    if (typeof optionId !== 'string' || typeof name !== 'string' || typeof kind !== 'string') {
      return [];
    }
    return [{ optionId, name, kind }];
  });
}

function boundedDetails(value: unknown): string {
  const text = safeJsonStringify(value);
  return text.length > PERMISSION_DETAIL_LIMIT
    ? `${text.slice(0, PERMISSION_DETAIL_LIMIT)}...`
    : text;
}

export const acpSessionService = new AcpSessionService();
