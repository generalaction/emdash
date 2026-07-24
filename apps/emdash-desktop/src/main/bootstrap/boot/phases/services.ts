import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import { app } from 'electron';
import { providerTokenRegistry } from '@core/features/account/api/node/provider-token-registry';
import { AccountAuthServerClient } from '@core/features/account/node/services/account-auth-server-client';
import { AccountOAuthClient } from '@core/features/account/node/services/account-oauth-client';
import type { AccountKVSchema } from '@core/features/account/node/services/account-session-store';
import { AccountCredentialStore } from '@core/features/account/node/services/credential-store';
import { createEmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { ProviderTokenDispatcher } from '@core/features/account/node/services/provider-token-dispatcher';
import { getPlugin, getPluginMetadata } from '@core/features/agents/api/node/plugin-registry';
import { WorkspaceTrustService } from '@core/features/agents/api/node/workspace-trust';
import { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { buildAutomationDeployment } from '@core/features/automations/node/deployment-builder';
import { TuiConversationProvider } from '@core/features/conversations/node/tui-conversation-provider';
import { GitHubApiAuthService } from '@core/features/github/api/node/services/github-api-auth-service';
import { githubRepositoryResolver } from '@core/features/github/api/node/services/github-repository-resolver';
import { ProjectGitHubAuthContextResolver } from '@core/features/github/api/node/services/project-github-auth-context-resolver';
import { GitHubAccountBackfillService } from '@core/features/github/node/accounts/github-account-backfill';
import { GitHubAccountReconciliationService } from '@core/features/github/node/accounts/github-account-reconciliation';
import { GitHubAccountService } from '@core/features/github/node/accounts/github-account-service';
import { GitHubCliAccountImportService } from '@core/features/github/node/accounts/github-cli-account-import';
import {
  GitHubKvAccountBackfillService,
  type LegacyKvGitHubAccount,
} from '@core/features/github/node/accounts/github-kv-account-backfill';
import { githubEvents } from '@core/features/github/node/event-host';
import {
  defaultGitHubDeviceAuthFactory,
  GitHubDeviceFlowService,
} from '@core/features/github/node/services/github-device-flow-service';
import { githubIdentityClient } from '@core/features/github/node/services/github-identity-client';
import { LegacyGitHubTokenMigrationStore } from '@core/features/github/node/services/legacy-github-token-migration-store';
import { setLegacyGitHubTokenMigrationStore } from '@core/features/github/node/services/legacy-github-token-migration-store-instance';
import { clearOctokitCache } from '@core/features/github/node/services/octokit-cache';
import { ProjectGitHubAccountBackfillService } from '@core/features/github/node/services/project-github-account-backfill';
import { createGitHubRepositoryService } from '@core/features/github/node/services/repo-service';
import {
  IntegrationConnectionService,
  setIntegrationConnectionService,
} from '@core/features/integrations/node/integration-connection-service';
import { IntegrationCredentialStore } from '@core/features/integrations/node/integration-credential-store';
import { setIntegrationCredentialStore } from '@core/features/integrations/node/integration-credential-store-instance';
import { createIssueProviderRegistry } from '@core/features/issues/node/registry';
import {
  createPromptLibraryService,
  type PromptLibraryKV,
} from '@core/features/library/node/prompt-library-service';
import { previewServerService } from '@core/features/preview-servers/api/node/preview-server-service-instance';
import { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { ProjectSettingsService } from '@core/features/projects/api/node/settings/project-settings-service';
import {
  createDeleteProjectOperationDefinition,
  submitReconcilerProjectCleanup,
} from '@core/features/projects/node/operations/delete-project-definition';
import {
  getProjectById,
  getProjectByPath,
} from '@core/features/projects/node/operations/getProjects';
import { createSearchService } from '@core/features/search/node/search-service';
import { TaskService } from '@core/features/tasks/api/node/task-service';
import { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import {
  createDeleteTaskOperationDefinition,
  submitReconcilerTaskCleanup,
} from '@core/features/tasks/node/operations/delete-task-definition';
import { installAutomationTelemetry } from '@core/features/telemetry/node/automation-telemetry';
import { installTaskTelemetry } from '@core/features/telemetry/node/task-telemetry';
import { desktopHostEvents } from '@core/features/workbench/node/event-host';
import {
  lifecycleWorkspaceIsUnused,
  WorkspaceInUseError,
} from '@core/features/workspaces/api/node/operations/lifecycle-cleanup';
import { resolveLifecycleOperationContext } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import {
  loadProjectWorktreeDirectory,
  WorkspacePlacementResolver,
} from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import { acquireWorkspaceRuntime } from '@core/features/workspaces/api/node/runtime-access';
import { WorkspaceBootstrapService } from '@core/features/workspaces/api/node/workspace-bootstrap-service';
import {
  createWorkspaceLifecycleParticipants,
  deactivateWorkspaceParticipants,
} from '@core/features/workspaces/node/lifecycle-participants';
import { listProjectWorkspaces } from '@core/features/workspaces/node/operations/list-project-workspaces';
import {
  createArchiveWorkspaceOperationDefinition,
  createDeleteWorkspaceOperationDefinition,
  submitReconcilerWorkspaceCleanup,
  type WorkspaceLifecycleDependencies,
} from '@core/features/workspaces/node/operations/workspace-lifecycle-definitions';
import { shouldProposeWorkspaceCleanup } from '@core/features/workspaces/node/operations/workspace-reconciliation-policy';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { createNotificationService } from '@core/services/notifications/node';
import { createOperationsEngine } from '@core/services/operations/node';
import { PullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { createProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { appService } from '@main/core/app/service';
import {
  createFileSearchRuntime,
  searchFileSearchRoot,
} from '@main/core/file-search/runtime-client';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { setOperationsEngine } from '@main/core/operations/operations-engine-instance';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { ensureAbsoluteDir } from '@main/core/runtime/files-helpers';
import { createCleanupSessionsOperationDefinition } from '@main/core/runtime/operations/cleanup-sessions-definition';
import {
  killLifecycleAcpSessions,
  killLifecycleTerminalSessions,
  resolveLifecycleSessionTargets,
  type SessionCleanupDependencies,
} from '@main/core/runtime/operations/session-cleanup';
import { executeOAuthFlow } from '@main/core/shared/oauth-flow';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import { runLocalCommand } from '@main/core/utils/exec';
import { KV } from '@main/db/kv';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { createDesktopWorkspaceRuntimeAcquirer } from '@main/gateway/workspace-runtime';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { createSystemNotificationSink } from '@main/host/notifications/system-notification-sink';
import { encryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { installUpdateNotifications } from '@main/host/updates/update-notifications';
import { applyNativeTheme, isAppFocused } from '@main/host/window';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { appScope } from '../../core/app-scope';
import { setCoreServiceInstances } from '../../core/service-instances';
import { registerProviderTokenHandlers, wireAccountTelemetry } from '../wiring';
import type { DatabaseBundle } from './database';
import type { InfrastructureBundle } from './infrastructure';

type JiraKVSchema = { creds: { siteUrl?: string; email?: string } };
type InstanceKVSchema = { connection: { instanceUrl?: string } };
type PlaneKVSchema = { connection: { apiBaseUrl?: string; workspaceSlug?: string } };
type GitHubKVSchema = { tokenSource: string };
type GitHubAccountsKVSchema = {
  accounts: LegacyKvGitHubAccount[];
  defaultAccountId: string | null;
};

export type ServicesBundle = {
  readonly account: ReturnType<typeof createEmdashAccountService>;
  readonly automations: AutomationsService;
  readonly github: {
    account: GitHubAccountService;
    deviceFlow: GitHubDeviceFlowService;
    reconciliation: GitHubAccountReconciliationService;
    repositories: ReturnType<typeof createGitHubRepositoryService>;
  };
  readonly issueProviders: ReturnType<typeof createIssueProviderRegistry>;
  readonly notifications: ReturnType<typeof createNotificationService>;
  readonly operations: Awaited<ReturnType<typeof createOperationsEngine>>['engine'];
  readonly promptLibrary: ReturnType<typeof createPromptLibraryService>;
  readonly projects: ProjectSessionManager;
  readonly projectSettings: ProjectSettingsService;
  readonly providerSettings: ReturnType<typeof createProviderOverrideSettings>;
  readonly pullRequestsRegistration: PullRequestsRegistration;
  readonly search: ReturnType<typeof createSearchService>;
  readonly taskService: TaskService;
  readonly taskSessions: TaskSessionManager;
  readonly workspaceBootstrap: WorkspaceBootstrapService;
  readonly workspacePlacement: WorkspacePlacementResolver;
};

export async function bootServices(
  database: DatabaseBundle,
  infrastructure: InfrastructureBundle,
  desktopRuntimes: DesktopRuntimes
): Promise<ServicesBundle> {
  const { appSettings: appSettingsService, db, sqlite, workspaceIdentity } = database;
  const { clients, broker: runtimes } = desktopRuntimes;
  const getMementosRuntimeClient = async () => clients.mementos;
  const getPullRequestsRuntimeClient = async () => clients.pullRequests;
  const getTerminalsRuntimeClient = async () => clients.terminals;
  const getTuiAgentsRuntimeClient = async () => clients.tuiAgents;
  const getWorkspaceRuntimeClient = async () => clients.workspace;
  previewServerService.attachSshRuntime({
    getConnectionState: (connectionId) =>
      infrastructure.ssh.manager.getConnectionState(connectionId),
    getSshProxy: async (connectionId) => {
      await infrastructure.ssh.ssh.ensureConnected(connectionId);
      const proxy = infrastructure.ssh.manager.getProxy(connectionId);
      if (!proxy) throw new Error(`SSH connection ${connectionId} is not available`);
      return proxy;
    },
  });
  const handleSshConnectionEvent = (
    event: Parameters<typeof previewServerService.handleSshConnectionEvent>[0]
  ) => {
    previewServerService.handleSshConnectionEvent(event);
  };
  infrastructure.ssh.manager.on('connection-event', handleSshConnectionEvent);
  appScope.add(() => {
    infrastructure.ssh.manager.off('connection-event', handleSshConnectionEvent);
  });
  const fileSearchRuntime = createFileSearchRuntime(runtimes);
  const providerOverrideSettings = createProviderOverrideSettings(db);
  const workspacePlacement = new WorkspacePlacementResolver({
    broker: runtimes,
    getSettings: () => appSettingsService,
    findProjectByPath: (host, projectPath) => getProjectByPath(db, host, projectPath),
    loadProjectWorktreeDirectory: (projectId) => loadProjectWorktreeDirectory(db, projectId),
  });
  const lifecycleParticipants = createWorkspaceLifecycleParticipants({
    registerFileSearchRoot: fileSearchRuntime.registerRoot,
    stopPreviewServers: (projectId, workspaceId) =>
      previewServerService.stopForWorkspace(projectId, workspaceId),
  });
  const taskSessionManager = new TaskSessionManager({
    db,
    runtimes,
    workspaceIdentity,
    deactivateWorkspaceParticipants: (identity) =>
      deactivateWorkspaceParticipants(lifecycleParticipants, identity),
  });
  const workspaceTrust = new WorkspaceTrustService({
    getTaskSettings: () => appSettingsService.get('tasks'),
    getTrustBehavior: (providerId) => getPlugin(providerId).behavior.trust,
  });
  const tuiConversationDependencies = {
    db,
    getLocalProjectSettings: () => appSettingsService.get('localProject'),
    getProviderConfig: (providerId: string) => providerOverrideSettings.getItem(providerId),
    getTerminalColorEnv,
    workspaceTrust,
  };
  const githubAccountBackfill = new ProjectGitHubAccountBackfillService(providerAccountRegistry);
  const projectManager = new ProjectSessionManager({
    db,
    taskSessions: taskSessionManager,
    createGitRepository: (client, repository, settings) =>
      new GitRepositoryService(client, repository, settings),
    createGitRepositoryFetch: (client, repository, getBaseRemote) =>
      new GitRepositoryFetchService(client, repository, getBaseRemote),
    ensureAbsoluteDir: (client, rootPath, absolutePath, options) =>
      ensureAbsoluteDir(async () => client, rootPath, absolutePath, options),
    runtimes,
    getProjectDefaults: async () => {
      const [localProject, project] = await Promise.all([
        appSettingsService.get('localProject'),
        appSettingsService.get('project'),
      ]);
      return {
        defaultWorktreeDirectory: localProject.defaultWorktreeDirectory,
        tmuxByDefault: project.tmuxByDefault,
      };
    },
    backfillGitHubAccount: async (provider) => {
      await githubAccountBackfill.backfillProject(provider);
    },
    workspacePlacement,
  });
  const projectSettingsService = new ProjectSettingsService({
    db,
    projects: projectManager,
    workspaceIdentity,
  });
  const workspaceBootstrapService = new WorkspaceBootstrapService({
    db,
    createConversationProvider: (options) =>
      new TuiConversationProvider(
        {
          projectId: options.projectId,
          taskId: options.taskId,
          taskPath: options.taskPath,
          host: options.host,
          files: options.files,
          tuiAgents: options.tuiAgents,
          tmux: options.tmuxEnabled,
          shellSetup: options.shellSetup,
          taskEnvVars: options.taskEnvVars,
        },
        tuiConversationDependencies
      ),
    getWorkspaceRuntimeClient,
    lifecycleParticipants,
    placement: workspacePlacement,
    projects: projectManager,
    runtimes,
    workspaceIdentity,
  });
  const taskService = new TaskService({
    db,
    projects: projectManager,
    sessions: taskSessionManager,
    workspaceBootstrap: workspaceBootstrapService,
    workspaceIdentity,
  });
  const searchService = createSearchService({
    db,
    sqlite,
    acquireWorkspaceRuntime: (workspaceId) =>
      acquireWorkspaceRuntime(runtimes, workspaceIdentity, workspaceId),
    searchFileSearchRoot,
    tasks: taskService,
  });
  searchService.initialize();
  const automationRuntime = {
    runtimes,
    getProjectById: (projectId: string) => getProjectById(db, projectId),
  };
  const automationsService = new AutomationsService({
    db,
    runtime: automationRuntime,
    buildDeployment: (automation) =>
      buildAutomationDeployment(
        {
          db,
          getProjectById: (projectId) => getProjectById(db, projectId),
          resolveWorkspace: (workspaceId) => workspaceIdentity.resolve(workspaceId),
          resolveWorktreePool: (project) => workspacePlacement.resolveWorktreePool(project),
        },
        automation
      ),
  });
  installAutomationTelemetry(telemetryService, automationsService);
  installTaskTelemetry(telemetryService, taskService, taskSessionManager);

  const accountCredentials = new AccountCredentialStore(encryptedAppSecretsStore, log);
  const accountService = createEmdashAccountService({
    authServerClient: new AccountAuthServerClient(),
    credentials: accountCredentials,
    keyValueStore: new AppDbKeyValueStore<AccountKVSchema>(db, 'account', log),
    oauthClient: new AccountOAuthClient(executeOAuthFlow),
    providerTokenDispatcher: new ProviderTokenDispatcher(providerTokenRegistry),
  });
  const promptLibraryService = createPromptLibraryService({
    db,
    keyValueStore: new AppDbKeyValueStore<PromptLibraryKV>(db, 'prompt-library', log),
  });
  const notificationService = createNotificationService({
    db,
    settings: appSettingsService,
    isAppFocused,
    onAgentEvent: (handler) => agentStatusService.on('agent:event', handler),
    resolveProviderName: (providerId) => {
      try {
        return getPluginMetadata(providerId).name;
      } catch {
        return providerId;
      }
    },
    logger: log,
    createSystemSink: createSystemNotificationSink,
  });
  const integrationCredentialStore = new IntegrationCredentialStore(
    providerAccountRegistry,
    {
      secrets: encryptedAppSecretsStore,
      kv: {
        jira: new KV<JiraKVSchema>('jira'),
        gitlab: new KV<InstanceKVSchema>('gitlab'),
        forgejo: new KV<InstanceKVSchema>('forgejo'),
        plane: new KV<PlaneKVSchema>('plane'),
      },
    },
    log
  );
  setIntegrationCredentialStore(integrationCredentialStore);
  setIntegrationConnectionService(
    new IntegrationConnectionService(integrationCredentialStore, telemetryService, log)
  );
  const githubKV = new KV<GitHubKVSchema>('github');
  const legacyGitHubTokens = new LegacyGitHubTokenMigrationStore(encryptedAppSecretsStore, {
    getTokenSource: () => githubKV.get('tokenSource'),
    clearTokenSource: () => githubKV.del('tokenSource'),
  });
  setLegacyGitHubTokenMigrationStore(legacyGitHubTokens);
  const githubCliImporter = new GitHubCliAccountImportService(
    providerAccountRegistry,
    runLocalCommand,
    githubIdentityClient
  );
  const githubAccountService = new GitHubAccountService(
    providerAccountRegistry,
    githubCliImporter,
    clearOctokitCache
  );
  const githubApiAuthService = new GitHubApiAuthService(providerAccountRegistry);
  const projectGitHubAuth = new ProjectGitHubAuthContextResolver({
    projects: projectManager,
    logger: log,
  });
  const issueProviders = createIssueProviderRegistry({
    github: {
      accounts: providerAccountRegistry,
      auth: githubApiAuthService,
      logger: log,
      resolveProjectAuthContext: (projectId) => projectGitHubAuth.resolve(projectId),
    },
  });
  const pullRequestsRegistration = new PullRequestsRegistration({
    getClient: getPullRequestsRuntimeClient,
    onProjectOpened: (handler) => projectManager.on('projectOpened', handler),
    onProjectClosed: (handler) => projectManager.on('projectClosed', handler),
    onProjectSettingsChanged: (handler) =>
      projectSettingsService.on('project-settings:changed', ({ projectId }) => handler(projectId)),
    onTaskProvisioned: (handler) => taskSessionManager.hooks.on('task:provisioned', handler),
    subscribeToProjectRemotes: (projectId, handler) =>
      projectManager.getProject(projectId)?.gitRepository.subscribeRemotes(handler),
    resolveProjectRepositoryUrls: async (projectId) => {
      const project = projectManager.getProject(projectId);
      if (!project) return [];
      const remotes = (
        await project.git.repository.model.state(project.repository, 'remotes').snapshot()
      ).data.remotes;
      const resolved = await Promise.all(
        remotes.map(async (remote) => await githubRepositoryResolver.resolve(remote.url))
      );
      return [
        ...new Set(
          resolved.flatMap((repository) =>
            repository.success ? [repository.data.repositoryUrl] : []
          )
        ),
      ];
    },
    resolveProjectAuthContext: (projectId) => projectGitHubAuth.resolve(projectId),
  });
  const githubRepositories = createGitHubRepositoryService(githubApiAuthService);
  const githubAuthPlugin = integrationPluginRegistry.get('github');
  const githubDeviceMethod = githubAuthPlugin?.capabilities.auth.methods.find(
    (candidate) => candidate.kind === 'oauth-device'
  );
  if (!githubDeviceMethod || githubDeviceMethod.kind !== 'oauth-device') {
    throw new Error('GitHub integration plugin does not declare an oauth-device auth method.');
  }
  const githubDeviceFlow = new GitHubDeviceFlowService({
    accountStore: providerAccountRegistry,
    identityClient: githubIdentityClient,
    publishEvent: (event) => githubEvents.emit(undefined, event),
    createDeviceAuth: defaultGitHubDeviceAuthFactory,
    config: {
      clientId: githubDeviceMethod.clientId,
      scopes: githubDeviceMethod.scopes,
    },
  });
  const githubAccountsKV = new KV<GitHubAccountsKVSchema>('githubAccounts');
  const githubKvBackfill = new GitHubKvAccountBackfillService(providerAccountRegistry, {
    getAccounts: () => githubAccountsKV.get('accounts'),
    getDefaultAccountId: () => githubAccountsKV.get('defaultAccountId'),
    clear: () => githubAccountsKV.clear(),
  });
  const githubLegacyBackfill = new GitHubAccountBackfillService(
    providerAccountRegistry,
    legacyGitHubTokens,
    githubIdentityClient
  );
  const githubReconciliation = new GitHubAccountReconciliationService({
    kvBackfill: githubKvBackfill,
    legacyBackfill: githubLegacyBackfill,
    cliImporter: githubCliImporter,
    logger: log,
  });
  const githubServices = {
    account: githubAccountService,
    deviceFlow: githubDeviceFlow,
    reconciliation: githubReconciliation,
    repositories: githubRepositories,
  };
  setCoreServiceInstances({
    account: accountService,
    appSettings: appSettingsService,
    notifications: notificationService,
    promptLibrary: promptLibraryService,
    providerSettings: providerOverrideSettings,
  });
  try {
    await telemetryService.initialize({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      installSource: app.isPackaged ? 'dmg' : 'dev',
    });
  } catch (error) {
    log.warn('telemetry init failed:', error);
  }

  wireAccountTelemetry(accountService);
  projectSettingsService.initialize();
  pullRequestsRegistration.initialize();
  appService.initialize({
    acquireWorkspaceRuntime: createDesktopWorkspaceRuntimeAcquirer(runtimes, workspaceIdentity),
    emitHostEvent: (event) => desktopHostEvents.emit(undefined, event),
  });
  await appSettingsService.initialize();
  applyNativeTheme(await appSettingsService.get('theme'));
  await automationsService.initialize();
  await notificationService.initialize();
  installUpdateNotifications(notificationService);
  browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
  setBrowserCorsRelaxationSettings(await appSettingsService.get('browser'));
  await promptLibraryService.initialize();
  const sessionCleanupDependencies: SessionCleanupDependencies = {
    async assertWorkspaceDeleteAllowed(database, operation) {
      if (
        operation.kind === 'delete-workspace' &&
        operation.workspaceId &&
        !(await lifecycleWorkspaceIsUnused(database, operation.workspaceId))
      ) {
        throw new WorkspaceInUseError();
      }
    },
    getAcpRuntimeClient: async () => clients.acp,
    getProjectTerminals: (projectId: string) => projectManager.getProject(projectId)?.terminals,
    getTerminalsRuntimeClient,
    getTuiAgentsRuntimeClient,
  };
  const lifecycleContext = {
    projects: projectManager,
    workspaceBootstrap: workspaceBootstrapService,
  };
  const lifecycleCleanup = {
    projects: projectManager,
    runtimes,
    unregisterFileSearchRoot: fileSearchRuntime.unregisterRoot,
  };
  const lifecycleSessions: WorkspaceLifecycleDependencies['sessions'] = {
    resolve: (database, operation, context) =>
      resolveLifecycleSessionTargets(sessionCleanupDependencies, database, operation, context),
    killAcp: (database, operation, targets) =>
      killLifecycleAcpSessions(sessionCleanupDependencies, database, operation, targets),
    killTerminals: (database, operation, operationContext, targets) =>
      killLifecycleTerminalSessions(
        sessionCleanupDependencies,
        database,
        operation,
        operationContext,
        targets
      ),
  };
  const workspaceLifecycle = {
    cleanup: lifecycleCleanup,
    lifecycleContext,
    sessions: lifecycleSessions,
  };
  const operations = await createOperationsEngine({
    scope: appScope,
    db,
    sshManager: infrastructure.ssh.manager,
    notifications: {
      publishPendingCleanup({ operationId, payload, hostRef, reason }) {
        notificationService.publish({
          kind: 'pending-cleanup',
          groupKey: `pending-cleanup:${hostRef}`,
          dedupeKey: `pending-cleanup:${operationId}:${reason}`,
          title: 'Pending cleanup needs review',
          body: `${payload.entityName ?? 'A workspace'} is waiting for cleanup review.`,
          sound: 'needs_attention',
          target: { kind: 'none' },
          source: { kind: 'app' },
        });
      },
    },
    definitions: [
      createDeleteTaskOperationDefinition({
        getMementosRuntimeClient,
        lifecycleCleanup,
        lifecycleContext,
        sessionCleanup: lifecycleSessions,
        telemetry: telemetryService,
        unregisterFileSearchRoot: fileSearchRuntime.unregisterRoot,
      }),
      createDeleteWorkspaceOperationDefinition(workspaceLifecycle),
      createArchiveWorkspaceOperationDefinition(workspaceLifecycle),
      createDeleteProjectOperationDefinition({
        automations: automationsService,
        getMementosRuntimeClient,
        logger: log,
        projects: projectManager,
        pullRequests: pullRequestsRegistration,
        telemetry: telemetryService,
      }),
      createCleanupSessionsOperationDefinition({
        sessionCleanup: sessionCleanupDependencies,
        resolveLifecycleOperationContext: (database, operation) =>
          resolveLifecycleOperationContext(lifecycleContext, database, operation, {
            resolveRuntimeConfig: true,
          }),
        submitReconcilerProjectCleanup,
        submitReconcilerTaskCleanup,
        submitReconcilerWorkspaceCleanup,
        listProjectWorkspaces: (projectId) =>
          listProjectWorkspaces(
            {
              db,
              runtimes,
              taskSessions: taskSessionManager,
            },
            projectId
          ),
        shouldProposeWorkspaceCleanup,
        getProjectTerminals: (projectId) => projectManager.getProject(projectId)?.terminals,
      }),
    ],
  });
  setOperationsEngine(operations);
  registerProviderTokenHandlers();
  return {
    account: accountService,
    automations: automationsService,
    github: githubServices,
    issueProviders,
    notifications: notificationService,
    operations: operations.engine,
    promptLibrary: promptLibraryService,
    projects: projectManager,
    projectSettings: projectSettingsService,
    providerSettings: providerOverrideSettings,
    pullRequestsRegistration,
    search: searchService,
    taskService,
    taskSessions: taskSessionManager,
    workspaceBootstrap: workspaceBootstrapService,
    workspacePlacement,
  };
}
