import { err, ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/api';
import { formatAbsolute, type HostFileRef } from '@primitives/path/api';
import type { AcpSessionStartContract, TuiSessionStartContract } from '@services/session-start/api';
import type { AutomationAgentConfig } from '../../api/deployment';
import type { AutomationPortError } from './port-error';

const HEADLESS_TERMINAL_COLS = 80;
const HEADLESS_TERMINAL_ROWS = 24;

export interface AutomationSessionPort {
  start(input: {
    conversationId: string;
    cwd: HostFileRef;
    agent: AutomationAgentConfig;
    signal: AbortSignal;
  }): Promise<Result<{ sessionId: string | null }, AutomationPortError>>;
}

export function createSessionPortFromDependencies(dependencies: {
  acp: ContractClient<AcpSessionStartContract>;
  tui: ContractClient<TuiSessionStartContract>;
}): AutomationSessionPort {
  return {
    async start(input) {
      const cwd = formatAbsolute(input.cwd.path, {
        separator: input.cwd.path.root.kind === 'posix' ? '/' : '\\',
      });

      try {
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
