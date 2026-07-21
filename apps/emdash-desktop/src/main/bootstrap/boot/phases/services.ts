import { resolve } from 'node:path';
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
import { appSettingsContributions } from '@core/manifests/shared/settings-contributions';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { createNotificationService } from '@core/services/notifications/node';
import { createOperationsEngine } from '@core/services/operations/node';
import { PullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { createAppSettingsService } from '@core/services/settings/node';
import { createProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import { SshCredentialService } from '@core/services/ssh/node/credentials/ssh-credential-service';
import {
  createR2WorkspaceServerArtifactSource,
  createRemoteFileWorkspaceServerArtifactSource,
  createWorkspaceServerService,
} from '@core/services/workspace-server/node';
import { createSshService } from '@main/bootstrap/core/ssh-service-factory';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { appService } from '@main/core/app/service';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { registerFileSearchRoot } from '@main/core/file-search/runtime-client';
import { unregisterFileSearchRoot } from '@main/core/file-search/runtime-client';
import { searchFileSearchRoot } from '@main/core/file-search/runtime-client';
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
import { KV } from '@main/db/kv';
import {
  getFilesRuntimeClient,
  getGitRuntimeClient,
  getAutomationsRuntimeClient,
  getMementosRuntimeClient,
  getTerminalsRuntimeClient,
  getPullRequestsRuntimeClient,
  getTuiAgentsRuntimeClient,
  getWorkspaceRuntimeClient,
} from '@main/gateway/desktop-workers';
import { getDesktopRuntimeBroker } from '@main/gateway/runtime-broker';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { createSystemNotificationSink } from '@main/host/notifications/system-notification-sink';
import { encryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { installUpdateNotifications } from '@main/host/updates/update-notifications';
import { isAppFocused } from '@main/host/window';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { appScope } from '../../core/app-scope';
import type { Phase } from '../../core/phase';
import { setCoreServiceInstances } from '../../core/service-instances';
import { configureQuitCleanupServices } from '../../shutdown/phases';
import type { BootContext } from '../types';
import { registerProviderTokenHandlers, wireAccountTelemetry } from '../wiring';

type JiraKVSchema = { creds: { siteUrl?: string; email?: string } };
type InstanceKVSchema = { connection: { instanceUrl?: string } };
type PlaneKVSchema = { connection: { apiBaseUrl?: string; workspaceSlug?: string } };
type GitHubKVSchema = { tokenSource: string };
type GitHubAccountsKVSchema = {
  accounts: LegacyKvGitHubAccount[];
  defaultAccountId: string | null;
};

export const configureServicesPhase: Phase<BootContext> = {
  name: 'configure-services',
  run() {
    return undefined;
  },
};

export const servicesPhase: Phase<BootContext> = {
  name: 'services',
  async run(context) {
    const db = context.db;
    if (!db) throw new Error('App database was not initialized before the services phase');
    const workspaceIdentity = context.workspaceIdentity;
    if (!workspaceIdentity) {
      throw new Error('Workspace identity service was not initialized before the services phase');
    }
    const appSettingsService = createAppSettingsService({
      db,
      contributions: appSettingsContributions,
    });
    const providerOverrideSettings = createProviderOverrideSettings(db);
    const runtimes = getDesktopRuntimeBroker();
    const workspacePlacement = new WorkspacePlacementResolver({
      broker: runtimes,
      getSettings: () => appSettingsService,
      findProjectByPath: (host, projectPath) => getProjectByPath(db, host, projectPath),
      loadProjectWorktreeDirectory: (projectId) => loadProjectWorktreeDirectory(db, projectId),
    });
    const lifecycleParticipants = createWorkspaceLifecycleParticipants({
      registerFileSearchRoot,
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
      getTuiAgentsRuntimeClient,
      workspaceTrust,
    };
    const githubAccountBackfill = new ProjectGitHubAccountBackfillService(providerAccountRegistry);
    const projectManager = new ProjectSessionManager({
      db,
      taskSessions: taskSessionManager,
      createExecutionContext: (root) => new LocalExecutionContext({ root }),
      createGitRepository: (client, repository, settings) =>
        new GitRepositoryService(client, repository, settings),
      createGitRepositoryFetch: (client, repository, getBaseRemote) =>
        new GitRepositoryFetchService(client, repository, getBaseRemote),
      ensureAbsoluteDir,
      getFilesRuntimeClient,
      getGitRuntimeClient,
      getWorkspaceRuntimeClient,
      getLocalProjectDefaults: async () => {
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
            tmux: options.tmuxEnabled,
            shellSetup: options.shellSetup,
            taskEnvVars: options.taskEnvVars,
          },
          tuiConversationDependencies
        ),
      getTerminalsRuntimeClient,
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
    const sqlite = context.sqlite;
    if (!sqlite) throw new Error('SQLite was not initialized before the services phase');
    const searchService = createSearchService({
      db,
      sqlite,
      acquireWorkspaceRuntime: (workspaceId) =>
        acquireWorkspaceRuntime(runtimes, workspaceIdentity, workspaceId),
      searchFileSearchRoot,
      tasks: taskService,
    });
    context.taskSessionManager = taskSessionManager;
    context.projectManager = projectManager;
    context.projectSettingsService = projectSettingsService;
    context.workspaceBootstrapService = workspaceBootstrapService;
    context.workspacePlacement = workspacePlacement;
    context.taskService = taskService;
    context.searchService = searchService;
    searchService.initialize();
    const automationRuntime = {
      getAutomationsRuntimeClient,
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
            resolveWorktreePool: (project) => workspacePlacement.resolveWorktreePool(project),
          },
          automation
        ),
    });
    context.automationsService = automationsService;
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
      new LocalExecutionContext(),
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
    context.issueProviders = createIssueProviderRegistry({
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
        projectSettingsService.on('project-settings:changed', ({ projectId }) =>
          handler(projectId)
        ),
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
    context.pullRequestsRegistration = pullRequestsRegistration;
    configureQuitCleanupServices({
      automations: automationsService,
      projects: projectManager,
      pullRequests: pullRequestsRegistration,
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
    context.githubServices = {
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
    context.accountService = accountService;
    context.appSettingsService = appSettingsService;
    context.notificationService = notificationService;
    context.promptLibraryService = promptLibraryService;
    context.providerOverrideSettings = providerOverrideSettings;

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
      emitHostEvent: (event) => desktopHostEvents.emit(undefined, event),
    });
    await appSettingsService.initialize();
    await automationsService.initialize();
    await notificationService.initialize();
    installUpdateNotifications(notificationService);
    context.ssh = createSshService({
      scope: appScope,
      db,
      credentials: new SshCredentialService(encryptedAppSecretsStore),
      logger: log,
      telemetry: telemetryService,
    });
    const artifactUrlOverride = process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'];
    const artifacts =
      app.isPackaged || artifactUrlOverride
        ? createR2WorkspaceServerArtifactSource(artifactUrlOverride)
        : createRemoteFileWorkspaceServerArtifactSource({
            localDirectory: resolve(app.getAppPath(), '../workspace-server/dist-artifacts'),
            remoteDirectory:
              process.env['EMDASH_WORKSPACE_SERVER_REMOTE_ARTIFACTS_DIR'] ??
              '/opt/emdash-artifacts',
          });
    context.workspaceServer = createWorkspaceServerService({
      scope: appScope,
      ssh: context.ssh,
      artifacts,
      logger: log,
    });
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
      getProjectExecutionContext: (projectId: string) => projectManager.getProject(projectId)?.ctx,
    };
    const lifecycleContext = {
      projects: projectManager,
      workspaceBootstrap: workspaceBootstrapService,
    };
    const lifecycleCleanup = {
      getWorkspaceRuntimeClient,
      projects: projectManager,
      unregisterFileSearchRoot,
    };
    const lifecycleSessions: WorkspaceLifecycleDependencies['sessions'] = {
      resolve: resolveLifecycleSessionTargets,
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
      sshManager: context.ssh.manager,
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
          unregisterFileSearchRoot,
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
                getGitRuntimeClient,
                taskSessions: taskSessionManager,
              },
              projectId
            ),
          shouldProposeWorkspaceCleanup,
          getProjectExecutionContext: (projectId) => projectManager.getProject(projectId)?.ctx,
        }),
      ],
    });
    setOperationsEngine(operations);
    context.operations = operations.engine;
    registerProviderTokenHandlers();
  },
};
