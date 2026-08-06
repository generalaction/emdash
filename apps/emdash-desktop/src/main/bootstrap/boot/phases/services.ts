import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import { app } from 'electron';
import { providerTokenRegistry } from '@core/features/account/api/node/provider-token-registry';
import { AccountAuthServerClient } from '@core/features/account/node/services/account-auth-server-client';
import { AccountOAuthClient } from '@core/features/account/node/services/account-oauth-client';
import type { AccountKVSchema } from '@core/features/account/node/services/account-session-store';
import { AccountCredentialStore } from '@core/features/account/node/services/credential-store';
import { createEmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { ProviderTokenDispatcher } from '@core/features/account/node/services/provider-token-dispatcher';
import { getPluginMetadata } from '@core/features/agents/api/node/plugin-registry';
import { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { buildAutomationDeployment } from '@core/features/automations/node/deployment-builder';
import { createConversationDeletionSweepKind } from '@core/features/conversations/node/sweep/conversation-deletion-sweep';
import { ConversationBackfillService } from '@core/features/conversations/node/sync/conversation-backfill';
import { ConversationSyncService } from '@core/features/conversations/node/sync/conversation-sync-service';
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
import type { ProjectDeletionDependencies } from '@core/features/projects/node/operations/deleteProject';
import {
  getProjectById,
  getProjectByPath,
} from '@core/features/projects/node/operations/getProjects';
import { createSearchService } from '@core/features/search/node/search-service';
import { TaskService } from '@core/features/tasks/api/node/task-service';
import type { TaskSessionCleanup } from '@core/features/tasks/api/node/task-session-cleanup';
import { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import { installAutomationTelemetry } from '@core/features/telemetry/node/automation-telemetry';
import { installTaskTelemetry } from '@core/features/telemetry/node/task-telemetry';
import { desktopHostEvents } from '@core/features/workbench/node/event-host';
import {
  createWorkspaceLifecycleParticipants,
  deactivateWorkspaceParticipants,
} from '@core/features/workspaces/api/node/lifecycle-participants';
import {
  loadProjectWorktreeDirectory,
  WorkspacePlacementResolver,
} from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import { WorkspaceCreations } from '@core/features/workspaces/api/node/registry-verbs';
import { acquireWorkspaceRuntime } from '@core/features/workspaces/api/node/runtime-access';
import type { TaskProviderOpts } from '@core/features/workspaces/api/node/workspace-factory';
import { createWorkspaceDeletionSweepKind } from '@core/features/workspaces/node/sweep/workspace-deletion-sweep';
import { WorkspaceRegistryBackfillService } from '@core/features/workspaces/node/sync/workspace-registry-backfill';
import { WorkspaceRegistrySyncService } from '@core/features/workspaces/node/sync/workspace-registry-sync-service';
import { startPeriodicSweep } from '@core/primitives/periodic-sweep/node/periodic-sweep';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { createNotificationService } from '@core/services/notifications/node';
import { PullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { ReconcileSweepService } from '@core/services/reconcile-sweep/node/reconcile-sweep-service';
import {
  createReconcileSweepTriggers,
  installReconcileSweepTriggers,
} from '@core/services/reconcile-sweep/node/reconcile-sweep-triggers';
import type { AppSettingsKey } from '@core/services/settings/api';
import { createProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import {
  createHostReachabilityProbe,
  type HostReachabilityProbe,
} from '@core/services/ssh/node/host-reachability';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { appService } from '@main/core/app/service';
import {
  createFileSearchRuntime,
  searchFileSearchRoot,
} from '@main/core/file-search/runtime-client';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { ensureAbsoluteDir } from '@main/core/runtime/files-helpers';
import {
  killLifecycleAcpSessions,
  killLifecycleTerminalSessions,
  resolveLifecycleSessionTargets,
  type SessionCleanupDependencies,
} from '@main/core/runtime/operations/session-cleanup';
import { sweepSessionHygiene } from '@main/core/runtime/operations/session-hygiene';
import { createDesktopSessionIntentStores } from '@main/core/runtime/session-intent-stores';
import { executeOAuthFlow } from '@main/core/shared/oauth-flow';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import { runLocalCommand } from '@main/core/utils/exec';
import { KV } from '@main/db/kv';
import { cleanupLegacyOperationsDatabases } from '@main/db/legacy-operations-cleanup';
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
  readonly hostIsReachable: HostReachabilityProbe;
  readonly notifications: ReturnType<typeof createNotificationService>;
  readonly promptLibrary: ReturnType<typeof createPromptLibraryService>;
  readonly projectDeletion: ProjectDeletionDependencies;
  readonly projects: ProjectSessionManager;
  readonly projectSettings: ProjectSettingsService;
  readonly providerSettings: ReturnType<typeof createProviderOverrideSettings>;
  readonly pullRequestsRegistration: PullRequestsRegistration;
  readonly search: ReturnType<typeof createSearchService>;
  readonly taskService: TaskService;
  readonly taskSessions: TaskSessionManager;
  readonly workspacePlacement: WorkspacePlacementResolver;
  readonly conversationSync: ConversationSyncService;
  readonly reconcileSweep: ReconcileSweepService;
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
  const fileSearchRuntime = createFileSearchRuntime(runtimes, {
    getSearchExclusions: async () => (await appSettingsService.get('files')).searchExclude,
  });
  const handleFileSearchSettingsChanged = (key: AppSettingsKey) => {
    if (key === 'files') void fileSearchRuntime.refreshExclusions();
  };
  appSettingsService.on('app-settings:changed', handleFileSearchSettingsChanged);
  appScope.add(() => {
    appSettingsService.off('app-settings:changed', handleFileSearchSettingsChanged);
  });
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
  const tuiConversationDependencies = {
    db,
    getProviderConfig: (providerId: string) => providerOverrideSettings.getItem(providerId),
    getTaskSettings: () => appSettingsService.get('tasks'),
    getTerminalColorEnv,
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
  });
  const projectSettingsService = new ProjectSettingsService({
    db,
    projects: projectManager,
    workspaceIdentity,
  });
  const createConversationProvider = (options: TaskProviderOpts) =>
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
    );
  const workspaceCreations = new WorkspaceCreations();
  const sessionCleanupDependencies: SessionCleanupDependencies = {
    getAcpRuntimeClient: async () => clients.acp,
    getProjectTerminals: (projectId: string) => projectManager.getProject(projectId)?.terminals,
    getTerminalsRuntimeClient,
    getTuiAgentsRuntimeClient,
  };
  const lifecycleSessions: TaskSessionCleanup = {
    resolve: (database, scope, context) =>
      resolveLifecycleSessionTargets(sessionCleanupDependencies, database, scope, context),
    killAcp: (database, scope, targets) =>
      killLifecycleAcpSessions(sessionCleanupDependencies, database, scope, targets),
    killTerminals: (database, scope, context, targets) =>
      killLifecycleTerminalSessions(sessionCleanupDependencies, database, scope, context, targets),
  };
  // Host reachability (ADR 0005): creation-side flows fail fast against offline
  // hosts; the probe is a plain read of the SSH connection state.
  const hostIsReachable = createHostReachabilityProbe(infrastructure.ssh.manager);
  const taskService = new TaskService({
    db,
    projects: projectManager,
    sessions: taskSessionManager,
    workspacePlacement,
    runtimes,
    lifecycleParticipants,
    createConversationProvider,
    workspaceIdentity,
    creations: workspaceCreations,
    hostIsReachable,
    // Plain task deletion (spec §3): no kernel submit; the host-artifact half rides
    // the workspace removal verbs and the reconcile-sweep tombstones.
    deletion: {
      db,
      runtimes,
      sessionCleanup: lifecycleSessions,
      getMementosRuntimeClient,
      telemetry: telemetryService,
      unregisterFileSearchRoot: fileSearchRuntime.unregisterRoot,
    },
  });
  const searchService = createSearchService({
    db,
    sqlite,
    acquireWorkspaceRuntime: (workspaceId) =>
      acquireWorkspaceRuntime(runtimes, workspaceIdentity, workspaceId),
    searchFileSearchRoot,
    getSearchExclusions: async () => (await appSettingsService.get('files')).searchExclude,
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
    subscribeToProjectRemotes: (projectId, handler) => {
      const project = projectManager.getProject(projectId);
      if (!project?.hasRepository) return undefined;
      return project.gitRepository.subscribeRemotes(handler);
    },
    resolveProjectRepositoryUrls: async (projectId) => {
      const project = projectManager.getProject(projectId);
      if (!project?.hasRepository) return [];
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
  // Plain project deletion (spec §3): the cascade reuses the task session cleanup and
  // the workspace removal verbs; nothing submits to the operations kernel.
  const projectDeletion: ProjectDeletionDependencies = {
    db,
    runtimes,
    automations: automationsService,
    getMementosRuntimeClient,
    logger: log,
    projects: projectManager,
    pullRequests: pullRequestsRegistration,
    sessionCleanup: lifecycleSessions,
    telemetry: telemetryService,
  };
  // Push-based mirror of each host's workspace registry (ADR 0005).
  const workspaceRegistrySync = new WorkspaceRegistrySyncService({
    db,
    runtimes,
    scope: appScope,
    onError: (context, error) => log.warn(context, { error }),
  });
  const workspaceRegistryBackfill = new WorkspaceRegistryBackfillService({
    db,
    runtimes,
    onError: (context, error) => log.warn(context, { error }),
  });
  // Backfill precedes attach so the first missing-sweep already sees pre-upgrade rows.
  const localWorkspaceRegistryReady = workspaceRegistryBackfill
    .backfillHost(LOCAL_HOST_REF)
    .then(() => workspaceRegistrySync.attachHost(LOCAL_HOST_REF));
  const conversationSync = new ConversationSyncService({
    db,
    runtimes,
    scope: appScope,
    onError: (context, error) => log.warn(context, { error }),
  });
  const conversationBackfill = new ConversationBackfillService({
    db,
    runtimes,
    onError: (context, error) => log.warn(context, { error }),
  });
  // Backfill precedes attach so the first missing-sweep already sees pre-upgrade records.
  void conversationBackfill
    .backfillHost(LOCAL_HOST_REF)
    .then(() => conversationSync.attachHost(LOCAL_HOST_REF));
  // The operations kernel is gone (ADR 0006 demolition): best-effort cleanup of the
  // orphaned SQLite store older builds left next to the app database.
  cleanupLegacyOperationsDatabases(log);
  // The reconcile sweep (ADR 0006): tombstoned mirror rows are the durable deletion
  // queue; they converge whenever their host is reachable. Boot trigger: the local
  // host attaches once its registry sync is up; the service's internal 10-minute
  // backstop is the retry vehicle (per-item backoff, no separate scheduler).
  const reconcileSweep = new ReconcileSweepService({
    scope: appScope,
    onError: (context, error) => log.warn(context, { error: String(error) }),
  });
  reconcileSweep.registerKind(createWorkspaceDeletionSweepKind({ db, runtimes }));
  // Conversations sweep after workspaces: the same-host ordering heuristic lets a
  // workspace cascade's freshly written conversation tombstones converge in the same
  // pass; correctness never depends on the order (ADR 0006).
  reconcileSweep.registerKind(createConversationDeletionSweepKind({ db, runtimes }));
  void localWorkspaceRegistryReady.then(() => reconcileSweep.attachHost(LOCAL_HOST_REF));
  // Tombstoned-while-reachable trigger: constructed here (composition root) and
  // installed on the module bridge the tombstone write paths poke.
  const reconcileSweepTriggers = createReconcileSweepTriggers();
  installReconcileSweepTriggers(reconcileSweepTriggers);
  appScope.add(
    reconcileSweepTriggers.subscribe((host) => {
      void reconcileSweep.sweepHost(host);
    })
  );
  const sessionHygieneDependencies = {
    agentStatus: agentStatusService,
    createSessionIntentStores: createDesktopSessionIntentStores,
    logger: log,
  };
  const sessionHygieneSweep = startPeriodicSweep({
    scope: appScope,
    intervalMs: 10 * 60 * 1000,
    run: () => sweepSessionHygiene(db, sessionHygieneDependencies),
    onError: (error) => {
      log.warn('session hygiene sweep failed', { error: String(error) });
    },
  });
  void sessionHygieneSweep.runNow().catch((error) => {
    log.warn('session hygiene sweep failed', { error: String(error) });
  });
  const handleConversationSyncSshEvent = (event: { type: string; connectionId?: string }) => {
    if (!event.connectionId) return;
    if (event.type === 'connected' || event.type === 'reconnected') {
      const host = hostRef('remote', event.connectionId);
      void conversationBackfill.backfillHost(host).then(() => conversationSync.attachHost(host));
      // The unreachable→reachable sweep trigger rides the same signal as the sync
      // attach, after it, so the first sweep sees a freshly converged mirror.
      void workspaceRegistryBackfill
        .backfillHost(host)
        .then(() => workspaceRegistrySync.attachHost(host))
        .then(() => reconcileSweep.attachHost(host));
      // Automation deletion tombstones have no sweep kind (no mirror row to key on);
      // their retry rides the same reconnect signal directly (ADR 0006).
      void automationsService.sweepDeletionTombstones();
    } else if (event.type === 'disconnected' || event.type === 'reconnect-failed') {
      conversationSync.detachHost(hostRef('remote', event.connectionId));
      workspaceRegistrySync.detachHost(hostRef('remote', event.connectionId));
      reconcileSweep.detachHost(hostRef('remote', event.connectionId));
    }
  };
  infrastructure.ssh.manager.on('connection-event', handleConversationSyncSshEvent);
  appScope.add(() => {
    infrastructure.ssh.manager.off('connection-event', handleConversationSyncSshEvent);
  });
  registerProviderTokenHandlers();
  return {
    account: accountService,
    automations: automationsService,
    github: githubServices,
    hostIsReachable,
    issueProviders,
    notifications: notificationService,
    promptLibrary: promptLibraryService,
    projectDeletion,
    projects: projectManager,
    projectSettings: projectSettingsService,
    providerSettings: providerOverrideSettings,
    pullRequestsRegistration,
    search: searchService,
    taskService,
    taskSessions: taskSessionManager,
    workspacePlacement,
    conversationSync,
    reconcileSweep,
  };
}
