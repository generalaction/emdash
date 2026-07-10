import type { McpServer } from '@emdash/core/mcp';
import type {
  AgentConfigAuthError,
  AgentConfigMcpError,
  AgentConfigRefreshError,
  AgentConfigSkillsError,
  AgentInstallError,
  AgentInstallProgress,
  AgentUninstallError,
  DependencyState,
} from '@emdash/core/workspace-server';
import type { AgentAuthStatus } from '@emdash/core/agents/plugins';
import type { Result } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire';
import type { CatalogSkill } from '@emdash/core/skills';
import type { LiveLog } from '@emdash/wire';
import {
  createAgentConfigAgentsLiveHost,
  createAgentConfigAgentsModel,
  createAgentConfigMcpLiveHost,
  createAgentConfigMcpModel,
  createAgentConfigSkillsLiveHost,
  createAgentConfigSkillsModel,
  type AgentConfigAgentsLiveHost,
  type AgentConfigMcpLiveHost,
  type AgentConfigSkillsLiveHost,
} from '../state/live-models';
import { AgentAuthManager } from './auth';
import { AgentInstallManager } from './install';
import { AgentMcpConfigManager } from './mcp';
import { AgentSkillsManager } from './skills';
import type { AgentConfigRuntimeDeps } from './types';

type InstallStrategy = { kind: 'package-manager'; method?: string } | { kind: 'custom'; command: string };
type UninstallStrategy =
  | { kind: 'package-manager'; method?: string }
  | { kind: 'custom'; command: string };

export class AgentConfigRuntime {
  private readonly agentsHost = createAgentConfigAgentsLiveHost();
  private readonly mcpHost = createAgentConfigMcpLiveHost();
  private readonly skillsHost = createAgentConfigSkillsLiveHost();
  private readonly agentsModel = createAgentConfigAgentsModel(this.agentsHost);
  private readonly mcpModel = createAgentConfigMcpModel(this.mcpHost);
  private readonly skillsModel = createAgentConfigSkillsModel(this.skillsHost);

  readonly install: AgentInstallManager;
  readonly auth: AgentAuthManager;
  readonly mcp: AgentMcpConfigManager;
  readonly skills: AgentSkillsManager;

  constructor(private readonly deps: AgentConfigRuntimeDeps) {
    this.install = new AgentInstallManager(deps, this.agentsModel);
    this.auth = new AgentAuthManager(deps, this.install);
    this.mcp = new AgentMcpConfigManager(deps, this.mcpModel);
    this.skills = new AgentSkillsManager(deps, this.skillsModel);
    this.install.initialize();
    void this.mcp.initialize();
    void this.skills.initialize();
  }

  agentsLiveHost(): AgentConfigAgentsLiveHost {
    return this.agentsHost;
  }

  mcpLiveHost(): AgentConfigMcpLiveHost {
    return this.mcpHost;
  }

  skillsLiveHost(): AgentConfigSkillsLiveHost {
    return this.skillsHost;
  }

  refreshAgents(input: {
    providerId?: string;
    refreshShellEnv?: boolean;
  }): Promise<Result<void, AgentConfigRefreshError>> {
    return this.install.refresh(input);
  }

  installAgent(
    providerId: string,
    strategy: InstallStrategy,
    ctx: LiveJobContext<AgentInstallProgress>
  ): Promise<Result<DependencyState, AgentInstallError>> {
    return this.install.install(providerId, strategy, ctx);
  }

  uninstallAgent(
    providerId: string,
    strategy?: UninstallStrategy
  ): Promise<Result<DependencyState, AgentUninstallError>> {
    return this.install.uninstall(providerId, strategy);
  }

  refreshAuthStatus(providerId: string): Promise<Result<AgentAuthStatus, AgentConfigAuthError>> {
    return this.auth.refreshAuthStatus(providerId);
  }

  startLogin(providerId: string, methodId: string): Promise<Result<void, AgentConfigAuthError>> {
    return this.auth.startLogin(providerId, methodId);
  }

  cancelLogin(providerId: string): Result<void, AgentConfigAuthError> {
    return this.auth.cancelLogin(providerId);
  }

  sendLoginInput(providerId: string, data: string): Result<void, AgentConfigAuthError> {
    return this.auth.sendLoginInput(providerId, data);
  }

  resizeLogin(providerId: string, cols: number, rows: number): Result<void, AgentConfigAuthError> {
    return this.auth.resizeLogin(providerId, cols, rows);
  }

  markUrlHandled(providerId: string, urlId: string): Result<void, AgentConfigAuthError> {
    return this.auth.markUrlHandled(providerId, urlId);
  }

  loginOutputLog(providerId: string): LiveLog | null {
    return this.auth.loginOutput(providerId);
  }

  saveMcpServer(server: McpServer): Promise<Result<void, AgentConfigMcpError>> {
    return this.mcp.saveServer(server);
  }

  removeMcpServer(name: string): Promise<Result<void, AgentConfigMcpError>> {
    return this.mcp.removeServer(name);
  }

  listMcpForAgent(providerId: string): Promise<Result<McpServer[], AgentConfigMcpError>> {
    return this.mcp.listForAgent(providerId);
  }

  installSkill(input: {
    skill: {
      id: string;
      installId?: string;
      skillMdContent: string;
      source?: CatalogSkill['source'];
      sourceRef?: string;
      catalogSkillId?: string;
      skillShPath?: string;
      iconUrl?: string;
    };
  }): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    return this.skills.installSkill(input.skill);
  }

  removeSkill(name: string): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    return this.skills.removeSkill(name);
  }

  createSkill(input: {
    name: string;
    description: string;
    content?: string;
  }): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    return this.skills.createSkill(input);
  }

  authStatusSource() {
    return {
      getStatus: (providerId: string, options?: { refresh?: boolean }) =>
        this.auth.getStatus(providerId, options),
      markUnauthenticated: (providerId: string, message?: string) =>
        this.auth.markUnauthenticated(providerId, message),
    };
  }

  dispose(): void {
    this.auth.dispose();
    this.install.dispose();
    this.agentsHost.dispose();
    this.mcpHost.dispose();
    this.skillsHost.dispose();
    this.deps.exec.dispose();
  }
}

