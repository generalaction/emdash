import type { Result } from '@emdash/shared';
import type { McpServer } from '@primitives/mcp/api';
import type { CatalogSkill } from '@primitives/skills/api';
import type {
  AgentConfigAuthError,
  AgentConfigMcpError,
  AgentConfigRefreshError,
  AgentConfigSkillsError,
} from '@runtimes/agent-config/api';
import type { AgentConfigRuntime } from '@runtimes/agent-config/node/runtime/runtime';
import type { AgentAuthStatus } from '@services/agent-plugins/api/plugins';

export function createAgentConfigProcedures(runtime: AgentConfigRuntime) {
  return {
    refreshAgents(input: {
      providerId?: string;
      refreshShellEnv?: boolean;
    }): Promise<Result<void, AgentConfigRefreshError>> {
      return runtime.refreshAgents(input);
    },
    startLogin(input: {
      providerId: string;
      methodId: string;
    }): Promise<Result<void, AgentConfigAuthError>> {
      return runtime.startLogin(input.providerId, input.methodId);
    },
    cancelLogin(input: { providerId: string }): Promise<Result<void, AgentConfigAuthError>> {
      return runtime.cancelLogin(input.providerId);
    },
    sendLoginInput(input: {
      providerId: string;
      data: string;
    }): Result<void, AgentConfigAuthError> {
      return runtime.sendLoginInput(input.providerId, input.data);
    },
    resizeLogin(input: {
      providerId: string;
      cols: number;
      rows: number;
    }): Result<void, AgentConfigAuthError> {
      return runtime.resizeLogin(input.providerId, input.cols, input.rows);
    },
    markUrlHandled(input: {
      providerId: string;
      urlId: string;
    }): Result<void, AgentConfigAuthError> {
      return runtime.markUrlHandled(input.providerId, input.urlId);
    },
    refreshAuthStatus(input: {
      providerId: string;
    }): Promise<Result<AgentAuthStatus, AgentConfigAuthError>> {
      return runtime.refreshAuthStatus(input.providerId);
    },
    saveMcpServer(input: { server: McpServer }): Promise<Result<void, AgentConfigMcpError>> {
      return runtime.saveMcpServer(input.server);
    },
    removeMcpServer(input: { name: string }): Promise<Result<void, AgentConfigMcpError>> {
      return runtime.removeMcpServer(input.name);
    },
    listMcpForAgent(input: {
      providerId: string;
    }): Promise<Result<McpServer[], AgentConfigMcpError>> {
      return runtime.listMcpForAgent(input.providerId);
    },
    installSkill(
      input: Parameters<AgentConfigRuntime['installSkill']>[0]
    ): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
      return runtime.installSkill(input);
    },
    removeSkill(input: { name: string }): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
      return runtime.removeSkill(input.name);
    },
    createSkill(
      input: Parameters<AgentConfigRuntime['createSkill']>[0]
    ): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
      return runtime.createSkill(input);
    },
  };
}

export type AgentConfigProcedures = ReturnType<typeof createAgentConfigProcedures>;
