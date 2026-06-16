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
  LoadSessionRequest,
  NewSessionRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SetSessionConfigOptionRequest,
  WriteTextFileRequest,
  WriteTextFileResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
} from '@agentclientprotocol/sdk';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { isAppFocused } from '@main/core/agent-hooks/notification';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { updateConversationModel } from '@main/core/conversations/updateConversationModel';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  acpSessionClosedChannel,
  acpSessionReplayChannel,
  acpSessionStatusChannel,
  acpSessionUpdateChannel,
} from '@shared/core/acp/acpEvents';
import type { AgentEvent } from '@shared/core/agents/agentEvents';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { buildAgentEnv } from '../pty/pty-env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-conversation state held inside a pool. */
interface AcpConversation {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  /** ACP-native session id assigned by newSession / loadSession. */
  acpSessionId: string | null;
  /** Model to apply after session is established (from persisted config). */
  pendingModel: string | null;
}

/**
 * One child process + connection shared by all conversations in a
 * (provider, workspace) pair.  poolKey = `${providerId}:${workspaceId}`.
 */
interface AcpPool {
  child: ChildProcess;
  connection: ClientSideConnection;
  providerId: string;
  workspaceId: string;
  path: string;
  /** All conversations currently multiplexed on this connection. */
  conversations: Map<string, AcpConversation>;
  /** Maps ACP sessionId → conversationId for routing incoming events. */
  sessionToConversation: Map<string, string>;
  /** Conversations currently awaiting loadSession so unknown-sessionId notifications can be routed. */
  loadingConversations: Set<string>;
  /** Promise that resolves once the pool's `initialize` call completes. */
  initialized: Promise<void> | null;
  stopped: boolean;
}

// ---------------------------------------------------------------------------
// AcpSessionManager
// ---------------------------------------------------------------------------

class AcpSessionManager {
  /** Pools keyed by `${providerId}:${workspaceId}`. */
  private pools = new Map<string, AcpPool>();

  /**
   * Secondary index: conversationId → { poolKey, acpSessionId } for fast
   * lookup from the public controller API without scanning pools.
   */
  private conversationIndex = new Map<string, { poolKey: string; acpSessionId: string | null }>();

  // -------------------------------------------------------------------------
  // Public API (keyed by conversationId — unchanged from callers' perspective)
  // -------------------------------------------------------------------------

  async start(
    conversation: Conversation,
    workspaceId: string,
    path: string,
    initialPrompt?: string
  ): Promise<void> {
    const { id: conversationId, providerId } = conversation;

    if (this.conversationIndex.has(conversationId)) {
      log.debug('AcpSessionManager: conversation already running', { conversationId });
      // Session already exists — report ready so any late subscriber gets the current state.
      events.emit(acpSessionStatusChannel, { conversationId, status: 'ready' });
      return;
    }

    const plugin = getPlugin(providerId);
    if (!plugin || plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior?.acp) {
      throw new Error(`AcpSessionManager: provider '${providerId}' does not support ACP transport`);
    }

    const poolKey = `${providerId}:${workspaceId}`;
    const pool = await this.getOrCreatePool(poolKey, providerId, workspaceId, path, plugin);

    // Wait for the pool's initialize handshake to finish before adding sessions.
    if (pool.initialized) {
      await pool.initialized;
    }

    // Build the per-conversation record.
    const conv: AcpConversation = {
      conversationId,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      providerId,
      acpSessionId: conversation.providerSessionId ?? null,
      pendingModel: conversation.model ?? null,
    };

    pool.conversations.set(conversationId, conv);
    this.conversationIndex.set(conversationId, { poolKey, acpSessionId: conv.acpSessionId });

    events.emit(acpSessionStatusChannel, { conversationId, status: 'starting' });

    try {
      let acpSessionId: string;

      if (conv.acpSessionId) {
        // Pre-register the stored session ID so notifications that use it are routed
        // immediately. Agents may also assign a new session ID during replay — the
        // buildClientHandler fallback will register that mapping dynamically via
        // loadingConversations.
        const originalSessionId = conv.acpSessionId;
        pool.sessionToConversation.set(originalSessionId, conversationId);
        pool.loadingConversations.add(conversationId);
        try {
          events.emit(acpSessionReplayChannel, { conversationId, phase: 'start' });
          await pool.connection.loadSession(this.buildLoadSessionRequest(path, originalSessionId));
          events.emit(acpSessionReplayChannel, { conversationId, phase: 'end' });
          // conv.acpSessionId may have been updated to a new ID by the dynamic routing
          // fallback in buildClientHandler. Use that updated value.
          acpSessionId = conv.acpSessionId;
          // Remove the old mapping when the agent adopted a different session ID.
          if (acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(originalSessionId);
          }
        } catch {
          log.warn('AcpSessionManager: loadSession failed, starting new session', {
            conversationId,
          });
          // Close the replay window so the renderer's ChatStore finalizes correctly.
          events.emit(acpSessionReplayChannel, { conversationId, phase: 'end' });
          // Clean up both the original pre-registration and any dynamically registered ID.
          pool.sessionToConversation.delete(originalSessionId);
          if (conv.acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(conv.acpSessionId);
          }
          const newResp = await pool.connection.newSession(this.buildNewSessionRequest(path));
          acpSessionId = newResp.sessionId;
        } finally {
          pool.loadingConversations.delete(conversationId);
        }
      } else {
        const newResp = await pool.connection.newSession(this.buildNewSessionRequest(path));
        acpSessionId = newResp.sessionId;
      }

      conv.acpSessionId = acpSessionId;
      pool.sessionToConversation.set(acpSessionId, conversationId);
      this.conversationIndex.set(conversationId, { poolKey, acpSessionId });

      // Persist the ACP session id so it survives pool teardown / app restart.
      void setProviderSessionId(conversationId, acpSessionId).catch(() => {
        // Non-fatal: worst case we lose resume on restart.
      });

      if (conv.pendingModel) {
        await this.applyModelInternal(pool.connection, acpSessionId, conv.pendingModel, conv);
      }

      // Session is ready — the agent can now accept prompts.
      events.emit(acpSessionStatusChannel, { conversationId, status: 'ready' });

      // Do not emit 'start' here — session setup alone is not agent activity.
      // start/stop are emitted in sendPromptInternal so status reflects actual
      // prompt execution, trusting the hook events as the source of truth.
      if (initialPrompt?.trim()) {
        await this.sendPromptInternal(pool, conv, initialPrompt);
      }
    } catch (err) {
      log.error('AcpSessionManager: failed to initialize ACP conversation', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Clean up the half-initialized conversation entry. Use a reverse lookup to
      // remove all session ID mappings for this conversation (covers both the original
      // pre-registered ID and any dynamically registered ID from loadSession replay).
      pool.conversations.delete(conversationId);
      this.conversationIndex.delete(conversationId);
      for (const [sid, cid] of pool.sessionToConversation) {
        if (cid === conversationId) pool.sessionToConversation.delete(sid);
      }
      if (pool.conversations.size === 0) {
        this.destroyPool(pool);
      }
      throw err;
    }
  }

  async prompt(conversationId: string, text: string): Promise<void> {
    const { pool, conv } = this.resolveConversation(conversationId);
    await this.sendPromptInternal(pool, conv, text);
  }

  async cancel(conversationId: string): Promise<void> {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) return;
    const pool = this.pools.get(entry.poolKey);
    if (!pool) return;
    try {
      await pool.connection.cancel({ sessionId: entry.acpSessionId });
    } catch (err) {
      log.warn('AcpSessionManager: cancel failed', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stop(conversationId: string): void {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return;
    const pool = this.pools.get(entry.poolKey);
    if (!pool) {
      this.conversationIndex.delete(conversationId);
      return;
    }
    const conv = pool.conversations.get(conversationId);

    // Best-effort closeSession so the agent can clean up state.
    if (conv?.acpSessionId) {
      void pool.connection.closeSession({ sessionId: conv.acpSessionId }).catch(() => {
        // agent-side closeSession is optional; ignore failures.
      });
      pool.sessionToConversation.delete(conv.acpSessionId);
    }

    pool.conversations.delete(conversationId);
    this.conversationIndex.delete(conversationId);

    // Tearing down this conversation's session is a session exit; mirror the PTY
    // path so a stuck 'working' status (e.g. tab closed mid-turn) is reset to idle.
    if (conv) {
      events.emit(agentSessionExitedChannel, {
        conversationId: conv.conversationId,
        taskId: conv.taskId,
      });
    }

    if (pool.conversations.size === 0) {
      this.destroyPool(pool);
    }
  }

  /**
   * Returns the current readiness state of a conversation's ACP session.
   * Used by the renderer to bootstrap `ChatStore.isReady` when the status
   * event may have fired before the store was created.
   */
  getSessionStatus(conversationId: string): 'ready' | 'starting' | 'none' {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return 'none';
    return entry.acpSessionId ? 'ready' : 'starting';
  }

  async setModel(conversationId: string, model: string): Promise<void> {
    const entry = this.conversationIndex.get(conversationId);
    const pool = entry ? this.pools.get(entry.poolKey) : undefined;
    const conv = pool ? pool.conversations.get(conversationId) : undefined;

    if (pool && conv && entry?.acpSessionId) {
      await this.applyModelInternal(pool.connection, entry.acpSessionId, model, conv);
    }

    void updateConversationModel(conversationId, model).catch((err) => {
      log.warn('AcpSessionManager: failed to persist model selection', {
        conversationId,
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  isRunning(conversationId: string): boolean {
    return this.conversationIndex.has(conversationId);
  }

  // -------------------------------------------------------------------------
  // Pool management
  // -------------------------------------------------------------------------

  private async getOrCreatePool(
    poolKey: string,
    providerId: string,
    workspaceId: string,
    path: string,
    plugin: ReturnType<typeof getPlugin> & object
  ): Promise<AcpPool> {
    const existing = this.pools.get(poolKey);
    if (existing) return existing;

    const agentEnv = buildAgentEnv({ agentApiVars: true });
    const { command, args, env } = (
      plugin as {
        behavior: {
          acp: {
            buildSpawn: (ctx: { cwd: string; env: NodeJS.ProcessEnv }) => {
              command: string;
              args: string[];
              env?: NodeJS.ProcessEnv;
            };
          };
        };
      }
    ).behavior.acp.buildSpawn({ cwd: path, env: agentEnv });

    const child = spawn(command, args, {
      cwd: path,
      env: { ...agentEnv, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdin === null || child.stdout === null) {
      throw new Error('AcpSessionManager: failed to spawn ACP child process (no stdio)');
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        log.debug('AcpSessionManager: agent stderr', {
          poolKey,
          text: data.toString().trim(),
        });
      });
    }

    const stream = ndJsonStream(
      nodeToWebWritable(child.stdin),
      nodeToWebReadable(child.stdout) as unknown as ReadableStream<Uint8Array>
    );

    const pool: AcpPool = {
      child,
      connection: null as unknown as ClientSideConnection,
      providerId,
      workspaceId,
      path,
      conversations: new Map(),
      sessionToConversation: new Map(),
      loadingConversations: new Set(),
      initialized: null,
      stopped: false,
    };

    const connection = new ClientSideConnection((_agent) => this.buildClientHandler(pool), stream);
    pool.connection = connection;

    // Register pool before awaiting initialize so concurrent start() calls see it.
    this.pools.set(poolKey, pool);

    void connection.closed.then(() => {
      this.handlePoolClosed(pool);
    });

    child.on('error', (err) => {
      log.error('AcpSessionManager: child process error', { poolKey, error: err.message });
      this.handlePoolClosed(pool);
    });

    const initReq: InitializeRequest = {
      protocolVersion: 1,
      clientInfo: { name: 'emdash', version: '1' },
    };

    pool.initialized = connection
      .initialize(initReq)
      .then((_resp: InitializeResponse) => {
        log.debug('AcpSessionManager: pool initialized', { poolKey });
      })
      .catch((err) => {
        log.error('AcpSessionManager: pool initialize failed', {
          poolKey,
          error: err instanceof Error ? err.message : String(err),
        });
        this.handlePoolClosed(pool);
        throw err;
      });

    return pool;
  }

  private destroyPool(pool: AcpPool): void {
    if (pool.stopped) return;
    pool.stopped = true;
    this.pools.delete(`${pool.providerId}:${pool.workspaceId}`);
    try {
      pool.child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  private handlePoolClosed(pool: AcpPool): void {
    if (pool.stopped) {
      // Already torn down by destroyPool — only clean up the index.
      for (const conv of pool.conversations.values()) {
        this.conversationIndex.delete(conv.conversationId);
      }
      return;
    }
    pool.stopped = true;
    this.pools.delete(`${pool.providerId}:${pool.workspaceId}`);

    const exitCode = pool.child.exitCode;

    // Fan out close events to every conversation that was live in this pool.
    for (const conv of pool.conversations.values()) {
      this.conversationIndex.delete(conv.conversationId);
      events.emit(acpSessionClosedChannel, {
        conversationId: conv.conversationId,
        exitCode,
      });
      events.emit(agentSessionExitedChannel, {
        conversationId: conv.conversationId,
        taskId: conv.taskId,
      });
    }

    log.debug('AcpSessionManager: pool closed', {
      poolKey: `${pool.providerId}:${pool.workspaceId}`,
      exitCode,
      conversationCount: pool.conversations.size,
    });

    pool.conversations.clear();
    pool.sessionToConversation.clear();
  }

  // -------------------------------------------------------------------------
  // Client handler (built once per pool, routes by sessionId)
  // -------------------------------------------------------------------------

  private buildClientHandler(pool: AcpPool): Client {
    return {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        const update = params.update;
        let conversationId = pool.sessionToConversation.get(params.sessionId);
        const usedDynamicRouting = !conversationId && pool.loadingConversations.size > 0;
        if (!conversationId && pool.loadingConversations.size > 0) {
          // The agent used a different session ID during loadSession replay than the
          // one provided in the request. Route to the pending conversation and register
          // the new mapping so subsequent notifications are routed without this fallback.
          const pendingId = pool.loadingConversations.values().next().value;
          if (pendingId) {
            conversationId = pendingId;
            pool.sessionToConversation.set(params.sessionId, pendingId);
            const conv = pool.conversations.get(pendingId);
            if (conv) conv.acpSessionId = params.sessionId;
          }
        }
        log.debug('AcpSessionManager: sessionUpdate routing [TEMP]', {
          sessionId: params.sessionId,
          conversationId,
          kind: update.sessionUpdate,
          usedDynamicRouting,
        });
        if (!conversationId) {
          log.warn('AcpSessionManager: sessionUpdate for unknown sessionId', {
            sessionId: params.sessionId,
          });
          return;
        }
        if (!pool.conversations.has(conversationId)) return;

        events.emit(acpSessionUpdateChannel, { conversationId, update });
      },

      requestPermission: async (
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> => {
        const conversationId = pool.sessionToConversation.get(params.sessionId);
        const allowOption =
          params.options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always') ??
          params.options[0];

        log.debug('AcpSessionManager: auto-approving permission request', {
          conversationId,
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

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private resolveConversation(conversationId: string): { pool: AcpPool; conv: AcpConversation } {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) {
      throw new Error(`AcpSessionManager: no active session for conversation ${conversationId}`);
    }
    const pool = this.pools.get(entry.poolKey);
    const conv = pool?.conversations.get(conversationId);
    if (!pool || !conv) {
      throw new Error(`AcpSessionManager: pool not found for conversation ${conversationId}`);
    }
    return { pool, conv };
  }

  private async sendPromptInternal(
    pool: AcpPool,
    conv: AcpConversation,
    text: string
  ): Promise<void> {
    if (!conv.acpSessionId) return;
    this.emitAgentEvent(conv, 'start');

    try {
      await pool.connection.prompt({
        sessionId: conv.acpSessionId,
        prompt: [{ type: 'text', text }],
      });
      this.emitAgentEvent(conv, 'stop');
    } catch (err) {
      log.error('AcpSessionManager: prompt error', {
        conversationId: conv.conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.emitAgentEvent(conv, 'error');
    }
  }

  private async applyModelInternal(
    connection: ClientSideConnection,
    acpSessionId: string,
    model: string,
    conv: AcpConversation
  ): Promise<void> {
    try {
      const req: SetSessionConfigOptionRequest = {
        sessionId: acpSessionId,
        configId: 'model',
        value: model,
      };
      await connection.setSessionConfigOption(req);
      conv.pendingModel = model;
    } catch (err) {
      log.warn('AcpSessionManager: failed to apply model selection', {
        conversationId: conv.conversationId,
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private buildNewSessionRequest(cwd: string): NewSessionRequest {
    return { cwd, mcpServers: [] };
  }

  private buildLoadSessionRequest(cwd: string, sessionId: string): LoadSessionRequest {
    return { sessionId, cwd, mcpServers: [] };
  }

  private emitAgentEvent(conv: AcpConversation, type: AgentEvent['type']): void {
    const event: AgentEvent = {
      type,
      source: 'hook',
      providerId: conv.providerId,
      projectId: conv.projectId,
      taskId: conv.taskId,
      conversationId: conv.conversationId,
      timestamp: Date.now(),
      payload: {},
    };
    agentHookService.emitAgentEvent(event, isAppFocused());
  }
}

export { AcpSessionManager };
export const acpSessionManager = new AcpSessionManager();
