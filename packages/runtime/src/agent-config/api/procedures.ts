import type { AgentAuthStatus } from '@emdash/core/agents/plugins';
import type { McpServer } from '@emdash/core/mcp';
import type { CatalogSkill } from '@emdash/core/skills';
import type {
  AgentConfigAuthError,
  AgentConfigMcpError,
  AgentConfigRefreshError,
  AgentConfigSkillsError,
  AgentUninstallError,
  DependencyState,
} from '@emdash/core/workspace-server';
import type { Result } from '@emdash/shared';
import type { AgentConfigRuntime } from '../runtime/runtime';

export function createAgentConfigProcedures(runtime: AgentConfigRuntime) {
  return {
    refreshAgents(input: {
      providerId?: string;
      refreshShellEnv?: boolean;
    }): Promise<Result<void, AgentConfigRefreshError>> {
      return runtime.refreshAgents(input);
    },
    uninstallAgent(input: {
      providerId: string;
      strategy?: { kind: 'package-manager'; method?: string } | { kind: 'custom'; command: string };
    }): Promise<Result<DependencyState, AgentUninstallError>> {
      return runtime.uninstallAgent(input.providerId, input.strategy);
    },
    startLogin(input: {
      providerId: string;
      methodId: string;
    }): Promise<Result<void, AgentConfigAuthError>> {
      return runtime.startLogin(input.providerId, input.methodId);
    },
    cancelLogin(input: { providerId: string }): Result<void, AgentConfigAuthError> {
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
