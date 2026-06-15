import { spawn, type ChildProcess } from 'node:child_process';
import {
  nodeToWebReadable,
  nodeToWebWritable,
} from '@agentclientprotocol/claude-agent-acp/dist/utils.js';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  Client,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  WriteTextFileRequest,
  WriteTextFileResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
} from '@agentclientprotocol/sdk';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { isAppFocused } from '@main/core/agent-hooks/notification';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { acpSessionClosedChannel, acpSessionUpdateChannel } from '@shared/core/acp/acpEvents';
import type { AgentEvent } from '@shared/core/agents/agentEvents';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { buildAgentEnv } from '../pty/pty-env';

interface AcpSession {
  child: ChildProcess;
  connection: ClientSideConnection;
  conversationId: string;
  taskId: string;
  projectId: string;
  providerId: string;
  /** ACP-native session id returned by newSession / loadSession. */
  acpSessionId: string | null;
  stopped: boolean;
}

class AcpSessionManager {
  private sessions = new Map<string, AcpSession>();

  async start(conversation: Conversation, taskPath: string, initialPrompt?: string): Promise<void> {
    const { id: conversationId, projectId, taskId, providerId } = conversation;

    if (this.sessions.has(conversationId)) {
      log.debug('AcpSessionManager: session already running', { conversationId });
      return;
    }

    const plugin = getPlugin(providerId);
    if (!plugin || plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior?.acp) {
      throw new Error(`AcpSessionManager: provider '${providerId}' does not support ACP transport`);
    }

    const agentEnv = buildAgentEnv({ agentApiVars: true });
    const { command, args, env } = plugin.behavior.acp.buildSpawn({ cwd: taskPath, env: agentEnv });

    const child = spawn(command, args, {
      cwd: taskPath,
      env: { ...agentEnv, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdin === null || child.stdout === null) {
      throw new Error('AcpSessionManager: failed to spawn ACP child process (no stdio)');
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        log.debug('AcpSessionManager: agent stderr', {
          conversationId,
          text: data.toString().trim(),
        });
      });
    }

    const stream = ndJsonStream(
      nodeToWebWritable(child.stdin),
      nodeToWebReadable(child.stdout) as unknown as ReadableStream<Uint8Array>
    );

    const session: AcpSession = {
      child,
      connection: null as unknown as ClientSideConnection,
      conversationId,
      taskId,
      projectId,
      providerId,
      acpSessionId: conversation.providerSessionId ?? null,
      stopped: false,
    };

    const clientHandler: Client = this.buildClientHandler(session);

    const connection = new ClientSideConnection((_agent) => clientHandler, stream);
    session.connection = connection;
    this.sessions.set(conversationId, session);

    // Closed = child exited or stream ended
    void connection.closed.then(() => {
      this.handleSessionClosed(session);
    });

    child.on('error', (err) => {
      log.error('AcpSessionManager: child process error', { conversationId, error: err.message });
      this.handleSessionClosed(session);
    });

    try {
      // Initialize the connection
      const initRequest: InitializeRequest = {
        protocolVersion: 1,
        clientInfo: { name: 'emdash', version: '1' },
      };
      const _initResp: InitializeResponse = await connection.initialize(initRequest);

      let acpSessionId: string;

      if (session.acpSessionId) {
        // Resume existing session; ResumeSessionResponse doesn't return a new sessionId
        try {
          await connection.resumeSession({
            sessionId: session.acpSessionId,
            cwd: taskPath,
          });
          acpSessionId = session.acpSessionId;
        } catch {
          // Fall back to new session if resume fails
          log.warn('AcpSessionManager: resume failed, starting new session', { conversationId });
          const newResp = await connection.newSession(this.buildNewSessionRequest(taskPath));
          acpSessionId = newResp.sessionId;
        }
      } else {
        const newResp = await connection.newSession(this.buildNewSessionRequest(taskPath));
        acpSessionId = newResp.sessionId;
      }

      session.acpSessionId = acpSessionId;

      // Emit start event so status badges work
      this.emitAgentEvent(session, 'start');

      if (initialPrompt?.trim()) {
        await this.sendPromptInternal(session, initialPrompt);
      }
    } catch (err) {
      log.error('AcpSessionManager: failed to initialize ACP session', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.killSession(conversationId);
      throw err;
    }
  }

  private buildNewSessionRequest(cwd: string): NewSessionRequest {
    return { cwd, mcpServers: [] };
  }

  async prompt(conversationId: string, text: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session || !session.acpSessionId) {
      throw new Error(`AcpSessionManager: no active session for conversation ${conversationId}`);
    }
    await this.sendPromptInternal(session, text);
  }

  private async sendPromptInternal(session: AcpSession, text: string): Promise<void> {
    if (!session.acpSessionId) return;
    this.emitAgentEvent(session, 'start');

    try {
      const resp = await session.connection.prompt({
        sessionId: session.acpSessionId,
        prompt: [{ type: 'text', text }],
      });
      // Emit idle/completed once the prompt turn resolves
      if (resp.stopReason === 'cancelled') {
        this.emitAgentEvent(session, 'stop');
      } else {
        this.emitAgentEvent(session, 'stop');
      }
    } catch (err) {
      log.error('AcpSessionManager: prompt error', {
        conversationId: session.conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.emitAgentEvent(session, 'error');
    }
  }

  async cancel(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session || !session.acpSessionId) return;
    try {
      await session.connection.cancel({ sessionId: session.acpSessionId });
    } catch (err) {
      log.warn('AcpSessionManager: cancel failed', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stop(conversationId: string): void {
    this.killSession(conversationId);
  }

  private killSession(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.stopped = true;
    this.sessions.delete(conversationId);
    try {
      session.child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  private handleSessionClosed(session: AcpSession): void {
    if (!this.sessions.has(session.conversationId) && session.stopped) return;
    this.sessions.delete(session.conversationId);

    const exitCode = session.child.exitCode;
    events.emit(acpSessionClosedChannel, {
      conversationId: session.conversationId,
      exitCode,
    });
    events.emit(agentSessionExitedChannel, {
      conversationId: session.conversationId,
      taskId: session.taskId,
    });

    log.debug('AcpSessionManager: session closed', {
      conversationId: session.conversationId,
      exitCode,
    });
  }

  private buildClientHandler(session: AcpSession): Client {
    return {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        events.emit(acpSessionUpdateChannel, {
          conversationId: session.conversationId,
          update: params.update,
        });
      },

      requestPermission: async (
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> => {
        // MVP: auto-approve by picking the first allow_once or allow_always option
        const allowOption =
          params.options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always') ??
          params.options[0];

        log.debug('AcpSessionManager: auto-approving permission request', {
          conversationId: session.conversationId,
          toolCallId: params.toolCall?.toolCallId,
          chosen: allowOption?.name,
        });

        return {
          outcome: {
            outcome: 'selected',
            optionId: allowOption?.optionId ?? params.options[0]?.optionId ?? '',
          },
        };
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        const { readFile } = await import('node:fs/promises');
        try {
          const content = await readFile(params.path, 'utf8');
          return { content };
        } catch (err) {
          throw new Error(
            `readTextFile failed for ${params.path}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        const { writeFile, mkdir } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        await mkdir(dirname(params.path), { recursive: true });
        await writeFile(params.path, params.content, 'utf8');
        return {};
      },
    };
  }

  private emitAgentEvent(session: AcpSession, type: AgentEvent['type']): void {
    const event: AgentEvent = {
      type,
      source: 'hook',
      providerId: session.providerId,
      projectId: session.projectId,
      taskId: session.taskId,
      conversationId: session.conversationId,
      timestamp: Date.now(),
      payload: {},
    };
    agentHookService.emitAgentEvent(event, isAppFocused());
  }

  isRunning(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }
}

export const acpSessionManager = new AcpSessionManager();
