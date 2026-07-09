import { LiveLog } from '@emdash/wire';
import type { AgentTerminalHooks } from '../agent-terminal-manager';
import type { TerminalState } from '../models/terminals';

type TerminalRecord = {
  conversationId: string;
  state: TerminalState;
  log: LiveLog;
};

/**
 * Mirrors terminal hook callbacks into live primitives.
 *
 * Terminal metadata/status is exposed as one LiveModel per conversation.
 * Terminal output is exposed as one LiveLog per terminal and should be treated
 * as the authoritative output stream by clients.
 */
export class TerminalLiveRegistry {
  private readonly byTerminal = new Map<string, TerminalRecord>();
  private readonly byConversation = new Map<string, Set<string>>();

  constructor(private readonly onConversationChanged?: (conversationId: string) => void) {}

  readonly hooks: AgentTerminalHooks = {
    onTerminalCreated: ({ conversationId, terminalId, command, args, cwd }) => {
      const record: TerminalRecord = {
        conversationId,
        state: {
          terminalId,
          command,
          args,
          cwd,
          output: '',
          truncated: false,
          exitStatus: null,
        },
        log: new LiveLog(),
      };
      this.byTerminal.set(terminalId, record);
      this.addToConversation(conversationId, terminalId);
      this.onConversationChanged?.(conversationId);
    },
    onTerminalOutput: ({ conversationId, terminalId, chunk, truncated }) => {
      const record = this.byTerminal.get(terminalId);
      if (!record) return;
      record.log.append(chunk);
      record.state = {
        ...record.state,
        output: `${record.state.output}${chunk}`,
        truncated,
      };
      this.byTerminal.set(terminalId, record);
      this.onConversationChanged?.(conversationId);
    },
    onTerminalExit: ({ conversationId, terminalId, exitStatus }) => {
      const record = this.byTerminal.get(terminalId);
      if (!record) return;
      record.state = { ...record.state, exitStatus };
      this.byTerminal.set(terminalId, record);
      this.onConversationChanged?.(conversationId);
    },
    onTerminalReleased: ({ conversationId, terminalId }) => {
      this.byTerminal.delete(terminalId);
      const ids = this.byConversation.get(conversationId);
      ids?.delete(terminalId);
      if (ids?.size === 0) this.byConversation.delete(conversationId);
      this.onConversationChanged?.(conversationId);
    },
  };

  getTerminalLog(terminalId: string): LiveLog | null {
    return this.byTerminal.get(terminalId)?.log ?? null;
  }

  private addToConversation(conversationId: string, terminalId: string): void {
    let ids = this.byConversation.get(conversationId);
    if (!ids) {
      ids = new Set();
      this.byConversation.set(conversationId, ids);
    }
    ids.add(terminalId);
  }

  snapshotConversation(conversationId: string): TerminalState[] {
    const ids = this.byConversation.get(conversationId);
    if (!ids) return [];
    return [...ids].flatMap((terminalId) => {
      const record = this.byTerminal.get(terminalId);
      return record ? [record.state] : [];
    });
  }
}
