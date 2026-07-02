import {
  AcpSessionRuntime,
  type AcpProcessHost,
  type AcpPromptImage,
  type AcpRuntimeError,
  type AcpRuntimeListener,
  type ChatHistory,
  type IAcpSessionRuntime,
  type ResolveAcpProvider,
  type SessionState,
  type TerminalSnapshot,
} from '@emdash/core/acp';
import type { Result } from '@emdash/shared';
import { ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { getPlugin } from '@main/core/agents/plugin-registry';
import { machineKey, type MachineRef } from '@main/core/runtime/types';
import type { Conversation } from '@shared/core/conversations/conversations';
import type { setSessionId } from '../conversations/set-session-id';

export interface AcpSessionManagerDeps {
  /** Resolves the getPlugin result for a given provider id. */
  getPlugin: (providerId: string) => ReturnType<typeof getPlugin>;
  /** Returns the AcpProcessHost for the given machine. */
  acquireProcessHost: (machine: MachineRef) => Promise<AcpProcessHost>;
  /** IPC event emitter used to build the runtime listener. */
  listener: AcpRuntimeListener;
  /** Persistence port for agent-assigned session ids. */
  setSessionId: typeof setSessionId;
  log: Logger;
}

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

  async start(
    conversation: Conversation,
    workspaceId: string,
    path: string,
    machine: MachineRef,
    initialPrompt?: string
  ): Promise<Result<void, AcpRuntimeError>> {
    const key = machineKey(machine);
    const runtime = await this.getOrCreateRuntime(key, machine);

    this.convToMachine.set(conversation.id, key);

    return runtime.start({
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

  async prompt(
    conversationId: string,
    text: string,
    images?: AcpPromptImage[]
  ): Promise<Result<void, AcpRuntimeError>> {
    const rt = this.findRuntime(conversationId);
    if (!rt) return ok();
    return rt.prompt(conversationId, text, images);
  }

  async cancel(conversationId: string): Promise<Result<void, AcpRuntimeError>> {
    const rt = this.findRuntime(conversationId);
    if (!rt) return ok();
    return rt.cancel(conversationId);
  }

  async setModel(conversationId: string, model: string): Promise<Result<void, AcpRuntimeError>> {
    const rt = this.findRuntime(conversationId);
    if (!rt) return ok();
    return rt.setModel(conversationId, model);
  }

  async setMode(conversationId: string, modeId: string): Promise<Result<void, AcpRuntimeError>> {
    const rt = this.findRuntime(conversationId);
    if (!rt) return ok();
    return rt.setMode(conversationId, modeId);
  }

  async setConfigOption(
    conversationId: string,
    configId: string,
    value: string
  ): Promise<Result<void, AcpRuntimeError>> {
    const rt = this.findRuntime(conversationId);
    if (!rt) return ok();
    return rt.setConfigOption(conversationId, configId, value);
  }

  stop(conversationId: string): Result<void, AcpRuntimeError> {
    const key = this.convToMachine.get(conversationId);
    const runtime = key ? this.runtimes.get(key) : undefined;
    if (!runtime) return ok();
    const result = runtime.stop(conversationId);
    this.convToMachine.delete(conversationId);
    return result;
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string | null
  ): Result<void, AcpRuntimeError> {
    const rt = this.findRuntime(conversationId);
    if (!rt) return ok();
    return rt.resolvePermission(conversationId, requestId, optionId);
  }

  isRunning(conversationId: string): boolean {
    const key = this.convToMachine.get(conversationId);
    const runtime = key ? this.runtimes.get(key) : undefined;
    return runtime?.isRunning(conversationId) ?? false;
  }

  getChatHistory(conversationId: string): ChatHistory {
    const rt = this.findRuntime(conversationId);
    if (!rt) return { turns: [], complete: true };
    return rt.getChatHistory(conversationId);
  }

  getSessionState(conversationId: string): SessionState {
    const rt = this.findRuntime(conversationId);
    if (!rt) {
      return {
        lifecycle: 'closed',
        activeTurn: null,
        pendingPermissions: [],
        modes: null,
        configOptions: [],
        availableCommands: [],
        lastStopReason: null,
        usage: null,
      };
    }
    return rt.getSessionState(conversationId);
  }

  getTerminals(conversationId: string): TerminalSnapshot[] {
    const rt = this.findRuntime(conversationId);
    return rt?.getTerminals(conversationId) ?? [];
  }

  getHostTerminals(machine: MachineRef): TerminalSnapshot[] {
    const key = machineKey(machine);
    return this.runtimes.get(key)?.getHostTerminals() ?? [];
  }

  killHostTerminals(machine: MachineRef): void {
    const key = machineKey(machine);
    this.runtimes.get(key)?.killAllTerminals();
  }

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
      listener: this.deps.listener,
      logger: this.deps.log,
    });

    this.runtimes.set(key, runtime);
    return runtime;
  }

  private findRuntime(conversationId: string): IAcpSessionRuntime | null {
    const key = this.convToMachine.get(conversationId);
    if (!key) return null;
    return this.runtimes.get(key) ?? null;
  }
}
