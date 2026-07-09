import type { AcpProcessHost, TerminalState } from '@emdash/core/acp';
import { ManagedAgentTerminal } from './managed-agent-terminal';

export interface AgentTerminalHooks {
  onTerminalCreated(e: {
    conversationId: string;
    terminalId: string;
    command: string;
    args: string[];
    cwd: string;
  }): void;
  onTerminalOutput(e: {
    conversationId: string;
    terminalId: string;
    chunk: string;
    truncated: boolean;
  }): void;
  onTerminalExit(e: {
    conversationId: string;
    terminalId: string;
    exitStatus: { exitCode: number | null; signal: string | null };
  }): void;
  onTerminalReleased(e: { conversationId: string; terminalId: string }): void;
}

/**
 * Host-scoped registry of all ACP agent-requested terminals.
 */
export class AgentTerminalManager {
  private readonly byId = new Map<
    string,
    { conversationId: string; terminal: ManagedAgentTerminal }
  >();
  private readonly byConversation = new Map<string, Set<string>>();

  constructor(
    private readonly host: AcpProcessHost,
    private readonly hooks: AgentTerminalHooks
  ) {}

  /** True when the host supports spawning agent terminals. */
  supportsTerminals(): boolean {
    return typeof this.host.spawnTerminal === 'function';
  }

  /**
   * Spawn a terminal command and register it under the given conversation.
   * Emits `onTerminalCreated` synchronously after registration.
   * Throws if the host does not support terminal spawning.
   */
  async create(
    conversationId: string,
    spec: {
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd: string;
      outputByteLimit?: number | null;
    }
  ): Promise<string> {
    if (!this.host.spawnTerminal) {
      throw new Error(
        'AgentTerminalManager: host does not support terminal spawning (spawnTerminal is undefined)'
      );
    }

    const terminalId = crypto.randomUUID();
    const proc = await this.host.spawnTerminal(spec);

    const terminal = new ManagedAgentTerminal(
      terminalId,
      spec.command,
      spec.args,
      spec.cwd,
      proc,
      (chunk, truncated) => {
        this.hooks.onTerminalOutput({ conversationId, terminalId, chunk, truncated });
      },
      (exitStatus) => {
        this.hooks.onTerminalExit({ conversationId, terminalId, exitStatus });
      },
      spec.outputByteLimit
    );

    this.byId.set(terminalId, { conversationId, terminal });
    let ids = this.byConversation.get(conversationId);
    if (!ids) {
      ids = new Set();
      this.byConversation.set(conversationId, ids);
    }
    ids.add(terminalId);

    this.hooks.onTerminalCreated({
      conversationId,
      terminalId,
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
    });

    return terminalId;
  }

  /** Retrieve a live terminal by id. Returns undefined if not found. */
  get(terminalId: string): ManagedAgentTerminal | undefined {
    return this.byId.get(terminalId)?.terminal;
  }

  /** Snapshots of all live terminals for a conversation. */
  listByConversation(conversationId: string): TerminalState[] {
    const ids = this.byConversation.get(conversationId);
    if (!ids) return [];
    const out: TerminalState[] = [];
    for (const id of ids) {
      const entry = this.byId.get(id);
      if (entry) out.push(entry.terminal.snapshot());
    }
    return out;
  }

  /** Snapshots of all live terminals across all conversations on this host. */
  listAll(): TerminalState[] {
    const out: TerminalState[] = [];
    for (const { terminal } of this.byId.values()) {
      out.push(terminal.snapshot());
    }
    return out;
  }

  /**
   * Dispose a single terminal and remove it from the registry.
   * Emits `onTerminalReleased`. No-op if the id is unknown.
   */
  release(terminalId: string): void {
    const entry = this.byId.get(terminalId);
    if (!entry) return;
    const { conversationId, terminal } = entry;
    terminal.dispose();
    this.byId.delete(terminalId);
    this.byConversation.get(conversationId)?.delete(terminalId);
    if (this.byConversation.get(conversationId)?.size === 0) {
      this.byConversation.delete(conversationId);
    }
    this.hooks.onTerminalReleased({ conversationId, terminalId });
  }

  /**
   * Dispose all terminals belonging to a conversation (called on session close).
   * Emits `onTerminalReleased` for each terminal.
   */
  disposeConversation(conversationId: string): void {
    const ids = this.byConversation.get(conversationId);
    if (!ids) return;
    for (const terminalId of [...ids]) {
      const entry = this.byId.get(terminalId);
      if (!entry) continue;
      entry.terminal.dispose();
      this.byId.delete(terminalId);
      this.hooks.onTerminalReleased({ conversationId, terminalId });
    }
    this.byConversation.delete(conversationId);
  }

  /**
   * Dispose every terminal on this host (called on host teardown).
   * Emits `onTerminalReleased` for each terminal.
   */
  killAll(): void {
    for (const [terminalId, { conversationId, terminal }] of this.byId) {
      terminal.dispose();
      this.hooks.onTerminalReleased({ conversationId, terminalId });
    }
    this.byId.clear();
    this.byConversation.clear();
  }
}
