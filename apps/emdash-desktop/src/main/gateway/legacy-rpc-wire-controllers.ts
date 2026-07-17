import type { DependencyId } from '@emdash/core/services/host-dependencies/node';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { createController, type Controller } from '@emdash/wire/api';
import {
  accountContract,
  agentsContract,
  appSettingsContract,
  editorContract,
  legacyPortContract,
  projectSettingsContract,
  projectWorkspacesContract,
  promptLibraryContract,
  repositoryContract,
  searchContract,
  telemetryContract,
} from '@core/manifests/legacy-rpc-wire-contracts';
import type { TelemetryEvent } from '@core/primitives/telemetry/api/telemetry';
import { accountOperations } from '@main/core/account/controller';
import { agentOperations } from '@main/core/agents/controller';
import { editorBufferOperations } from '@main/core/editor/controller';
import { promptLibraryOperations } from '@main/core/prompt-library/controller';
import { repositoryOperations } from '@main/core/repository/controller';
import { searchOperations } from '@main/core/search/controller';
import { appSettingsOperations } from '@main/core/settings/controller';
import { telemetryOperations } from '@main/core/telemetry/controller';
import { projectSettingsOperations } from '@main/core/workspaces/project-settings-controller';
import { projectWorkspaceOperations } from '@main/core/workspaces/project-workspaces-controller';
import { legacyPortOperations } from '@main/db/legacy-port/controller';

export function createLegacyRpcWireControllers(): Record<string, Controller> {
  return {
    account: createController(accountContract, {
      getSession: () => accountOperations.getSession(),
      signIn: ({ provider }) => accountOperations.signIn(provider),
      linkProviderAccount: ({ provider }) => accountOperations.linkProviderAccount(provider),
      signOut: () => accountOperations.signOut(),
      checkHealth: () => accountOperations.checkHealth(),
    }),
    agents: createController(agentsContract, {
      list: ({ connectionId }) => agentOperations.list(connectionId),
      get: ({ id, connectionId }) => agentOperations.get(id, connectionId),
      listAgentInstallationStatus: ({ connectionId }) =>
        agentOperations.listAgentInstallationStatus(connectionId),
      install: ({ id, connectionId, method }) =>
        agentOperations.install(id as AgentProviderId, connectionId, method),
      update: ({ id, connectionId, method }) =>
        agentOperations.update(id as AgentProviderId, connectionId, method),
      uninstall: ({ id, connectionId, method }) =>
        agentOperations.uninstall(id as AgentProviderId, connectionId, method),
      getDefaultSettings: ({ id }) => agentOperations.getDefaultSettings(id),
      getSettings: ({ id }) => agentOperations.getSettings(id),
      updateSettings: ({ id, config }) => agentOperations.updateSettings(id, config),
      setUsedInstallation: ({ id, connectionId, selection }) =>
        agentOperations.setUsedInstallation(id as DependencyId, connectionId, selection),
      probeOverride: ({ id, selection, connectionId }) =>
        agentOperations.probeOverride(id as DependencyId, selection, connectionId),
      refreshLatestVersion: ({ id, connectionId }) =>
        agentOperations.refreshLatestVersion(id as DependencyId, connectionId),
      probeAll: ({ connectionId }) => agentOperations.probeAll(connectionId),
    }),
    appSettings: createController(appSettingsContract, {
      get: ({ key }) => appSettingsOperations.get(key),
      getAll: () => appSettingsOperations.getAll(),
      getWithMeta: ({ key }) => appSettingsOperations.getWithMeta(key),
      update: ({ key, value }) => appSettingsOperations.update(key, value),
      reset: ({ key }) => appSettingsOperations.reset(key),
      resetField: ({ key, field }) => appSettingsOperations.resetField(key, field),
    }),
    telemetry: createController(telemetryContract, {
      capture: ({ event, properties }) =>
        telemetryOperations.capture({ event: event as TelemetryEvent, properties }),
      getStatus: () => telemetryOperations.getStatus(),
      setEnabled: ({ enabled }) => telemetryOperations.setEnabled(enabled),
      getFeatureFlags: () => telemetryOperations.getFeatureFlags(),
    }),
    search: createController(searchContract, {
      commandPalette: (input) => searchOperations.commandPalette(input),
      searchWorkspaceFiles: (input) => searchOperations.searchWorkspaceFiles(input),
    }),
    promptLibrary: createController(promptLibraryContract, {
      get: () => promptLibraryOperations.get(),
      update: ({ prompts }) => promptLibraryOperations.update(prompts),
    }),
    repository: createController(repositoryContract, {
      resolveProvider: ({ projectId }) => repositoryOperations.resolveProvider(projectId),
    }),
    projectSettings: createController(projectSettingsContract, {
      getSettings: ({ workspaceId }) => projectSettingsOperations.getSettings(workspaceId),
    }),
    projectWorkspaces: createController(projectWorkspacesContract, {
      listProjectWorkspaces: ({ projectId }) =>
        projectWorkspaceOperations.listProjectWorkspaces(projectId),
      measureProjectWorkspaces: (input) =>
        projectWorkspaceOperations.measureProjectWorkspaces(input),
      deleteProjectWorkspaces: (input) => projectWorkspaceOperations.deleteProjectWorkspaces(input),
    }),
    editor: createController(editorContract, {
      saveBuffer: ({ projectId, workspaceId, filePath, content }) =>
        editorBufferOperations.saveBuffer(projectId, workspaceId, filePath, content),
      clearBuffer: ({ projectId, workspaceId, filePath }) =>
        editorBufferOperations.clearBuffer(projectId, workspaceId, filePath),
      listBuffers: ({ projectId, workspaceId }) =>
        editorBufferOperations.listBuffers(projectId, workspaceId),
    }),
    legacyPort: createController(legacyPortContract, {
      checkStatus: () => legacyPortOperations.checkStatus(),
      getPreview: () => legacyPortOperations.getPreview(),
      runImport: (input) => legacyPortOperations.runImport(input),
    }),
  };
}
