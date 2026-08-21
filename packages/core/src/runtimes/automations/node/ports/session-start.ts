import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/rpc';
import { formatAbsolute, type HostFileRef } from '#primitives/path/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- run workspaces register and activate through the registry's plain verbs (workspaceHost retirement, spec §4.1); the contract has no services-level home yet
import type {
  ActivateWorkspaceError,
  CreateWorkspaceError,
  WorkspaceRegistryContract,
} from '#runtimes/workspace-registry/api';
import type {
  ConversationIndexContract,
  CreateConversationIndexRecordInput,
} from '#services/conversation-index/api';
import type { AcpSessionStartContract, TuiSessionStartContract } from '#services/session-start/api';
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
  workspaceRegistry: ContractClient<WorkspaceRegistryContract>;
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

        // Session-plane init runs register → activate through the registry before
        // any agent touches the worktree (spec §4.1): registration is idempotent
        // for existing paths, and activation returns once the prepare script
        // settles. Script failures surface as registry notices and never fail
        // activation; only a registry-level error blocks the session.
        const workspaceId = await registerWorkspace(
          dependencies.workspaceRegistry,
          cwd,
          input.signal
        );
        if (!workspaceId.success) return workspaceId;
        const activated = await dependencies.workspaceRegistry.activateWorkspace(
          { workspaceId: workspaceId.data },
          { signal: input.signal }
        );
        if (!activated.success) {
          return err({
            code: activated.error.type,
            message: describeActivateWorkspaceError(activated.error),
          });
        }
        if (input.agent.type === 'acp') {
          const result = await dependencies.acp.start(
            {
              conversationId: input.conversationId,
              cwd,
              sessionId: null,
              ...input.agent.start,
            },
            { signal: input.signal }
          );
          return result.success
            ? ok({ sessionId: result.data.sessionId })
            : err({ code: result.error.type, message: result.error.message });
        }

        const result = await dependencies.tui.start(
          {
            conversationId: input.conversationId,
            cwd,
            sessionId: null,
            cols: HEADLESS_TERMINAL_COLS,
            rows: HEADLESS_TERMINAL_ROWS,
            ...input.agent.start,
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
 * Idempotent workspace registration (the desktop's `createWorktreeThroughRegistry`
 * pattern, mirrored by the workspace-provisioning port): a fresh id either registers
 * the path or adopts the record that already owns it, so repeated runs converge on
 * one stable workspace id.
 */
async function registerWorkspace(
  client: ContractClient<WorkspaceRegistryContract>,
  path: string,
  signal: AbortSignal
): Promise<Result<string, AutomationPortError>> {
  const result = await client.createWorkspace({ workspaceId: randomUUID(), path }, { signal });
  if (result.success) return ok(result.data.id);
  return err({
    code: result.error.type,
    message: describeCreateWorkspaceError(result.error),
  });
}

function describeCreateWorkspaceError(error: CreateWorkspaceError): string {
  switch (error.type) {
    case 'path-not-found':
      return `Workspace path not found: ${error.path}`;
    case 'inspect-failed':
    case 'immutable-field-mismatch':
      return error.message;
  }
}

function describeActivateWorkspaceError(error: ActivateWorkspaceError): string {
  switch (error.type) {
    case 'workspace-not-found':
      return `Workspace record not found: ${error.workspaceId}`;
    case 'workspace-missing':
      return `Workspace path is missing on disk: ${error.workspaceId}`;
  }
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
    conversationId,
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
