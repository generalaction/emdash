import { err, ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/rpc';
import { formatAbsolute, type HostFileRef } from '#primitives/path/api';
import type {
  ConversationIndexContract,
  CreateConversationIndexRecordInput,
} from '#services/conversation-index/api';
import type { AcpSessionStartContract, TuiSessionStartContract } from '#services/session-start/api';
import type { WorkspaceHostActionsContract } from '#services/workspace-host-actions/api';
import type { AutomationAgentConfig } from '../../api/deployment';
import type { AutomationPortError } from './port-error';

const HEADLESS_TERMINAL_COLS = 80;
const HEADLESS_TERMINAL_ROWS = 24;

export interface AutomationSessionPort {
  start(input: {
    conversationId: string;
    cwd: HostFileRef;
    agent: AutomationAgentConfig;
    /** Run name, used as the record title when the agent config has none. */
    fallbackTitle: string;
    signal: AbortSignal;
  }): Promise<Result<{ sessionId: string | null }, AutomationPortError>>;
}

export function createSessionPortFromDependencies(dependencies: {
  workspaceHost: ContractClient<WorkspaceHostActionsContract>;
  acp: ContractClient<AcpSessionStartContract>;
  tui: ContractClient<TuiSessionStartContract>;
  conversationIndex: ContractClient<ConversationIndexContract>;
}): AutomationSessionPort {
  return {
    async start(input) {
      const cwd = formatAbsolute(input.cwd.path, {
        separator: input.cwd.path.root.kind === 'posix' ? '/' : '\\',
      });

      try {
        // Record creation is host-side (spec §10.5): the index record must exist —
        // dangling — before any session runtime reports against it. The desktop's
        // adoption flow only annotates its registry mirror afterwards.
        const created = await dependencies.conversationIndex.create(
          compileConversationIndexRecord(
            input.conversationId,
            cwd,
            input.agent,
            input.fallbackTitle
          ),
          { signal: input.signal }
        );
        if (!created.success) {
          return err({ code: created.error.type, message: created.error.message });
        }

        // Session-plane init runs start → prepare → activate before any agent
        // touches the worktree. A failed prepare script is non-fatal (the host
        // surfaces it through workspace notices); only an initialization error
        // blocks the session.
        const initialized = await dependencies.workspaceHost.initializeWorkspace(
          { workspacePath: input.cwd.path },
          { signal: input.signal }
        );
        if (!initialized.success) {
          return err({ code: initialized.error.type, message: initialized.error.message });
        }
        if (input.agent.type === 'acp') {
          const result = await dependencies.acp.startSession(
            {
              input: {
                conversationId: input.conversationId,
                cwd,
                sessionId: null,
                ...input.agent.start,
              },
            },
            { signal: input.signal }
          );
          return result.success
            ? ok({ sessionId: result.data.sessionId })
            : err({ code: result.error.type, message: result.error.message });
        }

        const result = await dependencies.tui.startSession(
          {
            input: {
              conversationId: input.conversationId,
              cwd,
              sessionId: null,
              cols: HEADLESS_TERMINAL_COLS,
              rows: HEADLESS_TERMINAL_ROWS,
              ...input.agent.start,
            },
          },
          { signal: input.signal }
        );
        return result.success
          ? ok({ sessionId: null })
          : err({ code: result.error.type, message: result.error.message });
      } catch (error) {
        return err({
          code: 'session_start_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Mirrors the desktop client's config shape (`conversationForRun`) so the record's stored
 * start payload round-trips into the client registry mirror unchanged.
 */
function compileConversationIndexRecord(
  conversationId: string,
  cwd: string,
  agent: AutomationAgentConfig,
  fallbackTitle: string
): CreateConversationIndexRecordInput {
  const config =
    agent.type === 'acp'
      ? {
          version: '1',
          type: 'acp',
          ...(agent.start.model && { model: agent.start.model }),
          ...(agent.start.modeId && { modeId: agent.start.modeId }),
          initialQueue: agent.start.initialQueue,
        }
      : {
          version: '1',
          type: 'pty',
          autoApprove: agent.start.autoApprove,
          ...(agent.start.model && { model: agent.start.model }),
          initialPrompt: agent.start.initialPrompt,
        };
  return {
    id: conversationId,
    provider: agent.start.providerId,
    type: agent.type === 'acp' ? 'acp' : 'pty',
    cwd,
    workspacePath: cwd,
    // ACP providers mint their own session ids; TUI sessions run under the
    // emdash-chosen conversation id (spec §3.1).
    idRegime: agent.type === 'acp' ? 'provider-minted' : 'emdash-chosen',
    createdAt: Date.now(),
    title: agent.title ?? fallbackTitle,
    config,
  };
}
