import type {
  AcpProcessHost,
  AcpPromptImage,
  ChatHistory,
  IAcpSessionRuntime,
  SessionState,
} from '@emdash/core/acp';
import { AcpSessionRuntime } from '@emdash/core/acp';
import type { AcpRuntimeListener, AcpRuntimeLog, ResolveAcpProvider } from '@emdash/core/acp';
import type { getPlugin } from '@main/core/agents/plugin-registry';
import { machineKey, type MachineRef } from '@main/core/runtime/types';
import type { Conversation } from '@shared/core/conversations/conversations';
import type { setSessionId } from '../conversations/set-session-id';
import type { updateConversationModel } from '../conversations/updateConversationModel';

// ---------------------------------------------------------------------------
// AcpSessionManagerLog (kept for prod wiring type convenience)
// ---------------------------------------------------------------------------

export type AcpSessionManagerLog = AcpRuntimeLog;

// ---------------------------------------------------------------------------
// AcpSessionManagerDeps
// ---------------------------------------------------------------------------

export interface AcpSessionManagerDeps {
  /** Resolves the getPlugin result for a given provider id. */
  getPlugin: (providerId: string) => ReturnType<typeof getPlugin>;
  /** Returns the AcpProcessHost for the given machine. */
  acquireProcessHost: (machine: MachineRef) => Promise<AcpProcessHost>;
  /** IPC event emitter used to build the runtime listener. */
  listener: AcpRuntimeListener;
  /** Persistence port for agent-assigned session ids. */
  setSessionId: typeof setSessionId;
  /** Persistence port for model selections. */
  updateConversationModel: typeof updateConversationModel;
  log: AcpSessionManagerLog;
}

// ---------------------------------------------------------------------------
// AcpSessionManager — thin per-machine router
// ---------------------------------------------------------------------------

/**
 * Desktop-side ACP manager. Holds a Map<machineKey, IAcpSessionRuntime> and
 * routes calls to the appropriate runtime. One runtime is created per machine
 * the first time a conversation on that machine is started.
 *
 * The session engine lives in AcpSessionRuntime (@emdash/core).
 */
export class AcpSessionManager {
  private readonly runtimes = new Map<string, IAcpSessionRuntime>();
  private readonly convToMachine = new Map<string, string>();
  private readonly deps: AcpSessionManagerDeps;

  constructor(deps: AcpSessionManagerDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // Public API (matches the existing signature expected by controller + hydrate)
  // -------------------------------------------------------------------------

  async start(
    conversation: Conversation,
    workspaceId: string,
    path: string,
    machine: MachineRef,
    initialPrompt?: string
  ): Promise<void> {
    const key = machineKey(machine);
    const runtime = await this.getOrCreateRuntime(key, machine);

    this.convToMachine.set(conversation.id, key);

    await runtime.start({
      conversationId: conversation.id,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      providerId: conversation.providerId,
      workspaceId,
      cwd: path,
      sessionId: conversation.sessionId ?? null,
      model: conversation.model ?? null,
      initialPrompt,
    });
  }

  async prompt(conversationId: string, text: string, images?: AcpPromptImage[]): Promise<void> {
    await this.getRuntime(conversationId).prompt(conversationId, text, images);
  }

  async cancel(conversationId: string): Promise<void> {
    await this.getRuntime(conversationId).cancel(conversationId);
  }

  async setModel(conversationId: string, model: string): Promise<void> {
    await this.getRuntime(conversationId).setModel(conversationId, model);
  }

  stop(conversationId: string): void {
    const key = this.convToMachine.get(conversationId);
    const runtime = key ? this.runtimes.get(key) : undefined;
    if (!runtime) return;
    runtime.stop(conversationId);
    this.convToMachine.delete(conversationId);
  }

  resolvePermission(conversationId: string, requestId: string, optionId: string | null): void {
    this.getRuntime(conversationId).resolvePermission(conversationId, requestId, optionId);
  }

  isRunning(conversationId: string): boolean {
    const key = this.convToMachine.get(conversationId);
    const runtime = key ? this.runtimes.get(key) : undefined;
    return runtime?.isRunning(conversationId) ?? false;
  }

  getChatHistory(conversationId: string): ChatHistory {
    const key = this.convToMachine.get(conversationId);
    const runtime = key ? this.runtimes.get(key) : undefined;
    if (!runtime) return { turns: [], complete: true };
    return runtime.getChatHistory(conversationId);
  }

  getSessionState(conversationId: string): SessionState {
    const key = this.convToMachine.get(conversationId);
    const runtime = key ? this.runtimes.get(key) : undefined;
    if (!runtime)
      return { lifecycle: 'closed', activeTurn: null, model: null, pendingPermissions: [] };
    return runtime.getSessionState(conversationId);
  }

  // -------------------------------------------------------------------------
  // Runtime creation
  // -------------------------------------------------------------------------

  private async getOrCreateRuntime(key: string, machine: MachineRef): Promise<IAcpSessionRuntime> {
    const existing = this.runtimes.get(key);
    if (existing) return existing;

    const host = await this.deps.acquireProcessHost(machine);
    const resolveAcp: ResolveAcpProvider = (providerId) => {
      const plugin = this.deps.getPlugin(providerId);
      if (plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior?.acp) return null;
      return { behavior: plugin.behavior.acp };
    };

    const runtime = new AcpSessionRuntime({
      resolveAcp,
      host,
      persistSessionId: (conversationId, sessionId) =>
        this.deps.setSessionId(conversationId, sessionId),
      persistModel: (conversationId, model) =>
        this.deps.updateConversationModel(conversationId, model),
      listener: this.deps.listener,
      log: this.deps.log,
    });

    this.runtimes.set(key, runtime);
    return runtime;
  }

  private getRuntime(conversationId: string): IAcpSessionRuntime {
    const key = this.convToMachine.get(conversationId);
    const runtime = key ? this.runtimes.get(key) : undefined;
    if (!runtime) {
      throw new Error(`AcpSessionManager: no runtime for conversation ${conversationId}`);
    }
    return runtime;
  }
}
