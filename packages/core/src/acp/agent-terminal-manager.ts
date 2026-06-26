import { ManagedAgentTerminal } from './managed-agent-terminal';
import type { TerminalSnapshot } from './terminals';
import type { AcpProcessHost } from './transport';

// ---------------------------------------------------------------------------
// Minimal listener surface the manager needs — avoids importing the full
// AcpRuntimeListener so this file stays self-contained.
// ---------------------------------------------------------------------------

export interface AgentTerminalListener {
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

// ---------------------------------------------------------------------------
// AgentTerminalManager
// ---------------------------------------------------------------------------

/**
 * Host-scoped registry of all ACP agent-requested terminals.
 *
 * One instance lives on the per-host AcpSessionRuntime (the runtime is 1:1
 * with a MachineRef). Every conversation's terminals are registered here,
 * which enables host-level operations (listAll, killAll) that per-conversation
 * tracking cannot provide.
 *
 * Responsibilities:
 *   - Spawn terminals via the host and wrap them in ManagedAgentTerminal.
 *   - Maintain a host-wide id → entry map and a conversation → id-set index.
 *   - Forward output/exit events to the listener (closing over conversationId).
 *   - Release individual terminals, all terminals for a conversation, or every
 *     terminal on the host.
 */
export class AgentTerminalManager {
  private readonly byId = new Map<
    string,
    { conversationId: string; terminal: ManagedAgentTerminal }
  >();
  private readonly byConversation = new Map<string, Set<string>>();

  constructor(
    private readonly host: AcpProcessHost,
    private readonly listener: AgentTerminalListener
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
        this.listener.onTerminalOutput({ conversationId, terminalId, chunk, truncated });
      },
      (exitStatus) => {
        this.listener.onTerminalExit({ conversationId, terminalId, exitStatus });
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

    this.listener.onTerminalCreated({
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
  listByConversation(conversationId: string): TerminalSnapshot[] {
    const ids = this.byConversation.get(conversationId);
    if (!ids) return [];
    const out: TerminalSnapshot[] = [];
    for (const id of ids) {
      const entry = this.byId.get(id);
      if (entry) out.push(entry.terminal.snapshot());
    }
    return out;
  }

  /** Snapshots of all live terminals across all conversations on this host. */
  listAll(): TerminalSnapshot[] {
    const out: TerminalSnapshot[] = [];
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
    this.listener.onTerminalReleased({ conversationId, terminalId });
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
      this.listener.onTerminalReleased({ conversationId, terminalId });
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
      this.listener.onTerminalReleased({ conversationId, terminalId });
    }
    this.byId.clear();
    this.byConversation.clear();
  }
}
