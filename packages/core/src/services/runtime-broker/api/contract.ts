import { defineContract } from '@emdash/wire';
import { acpApiContract } from '../../../runtimes/acp/api';
import { agentConfigContract } from '../../../runtimes/agent-config/api';
import { automationsContract } from '../../../runtimes/automations/api';
import { fileSearchContract } from '../../../runtimes/file-search/api';
import { filesContract } from '../../../runtimes/files/api';
import { gitContract } from '../../../runtimes/git/api';
import { terminalsContract } from '../../../runtimes/terminals/api';
import { tuiAgentsContract } from '../../../runtimes/tui-agents/api';
import { workspaceContract } from '../../../runtimes/workspace/api';
import { hostDependenciesContract } from '../../host-dependencies/api';

/**
 * Raw host-scoped runtime surface. Desktop slice controllers adapt this
 * contract to app-id-keyed renderer contracts; it is never exposed directly.
 *
 * Scoping notes:
 * - `fs-watch` is a private intra-worker dependency, not a host runtime.
 * - `mementos` and `pull-requests` are app-scoped desktop workers keyed by
 *   `userData` databases, not by host, and are intentionally excluded.
 */
export const hostRuntimesDefinitions = {
  git: gitContract,
  fileSearch: fileSearchContract,
  files: filesContract,
  acp: acpApiContract,
  automations: automationsContract,
  tuiAgents: tuiAgentsContract,
  agentConfig: agentConfigContract,
  terminals: terminalsContract,
  workspace: workspaceContract,
  hostDependencies: hostDependenciesContract,
} as const;

export const hostRuntimesContract = defineContract(hostRuntimesDefinitions);
