import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  AgentInstallationStatus,
  AgentPayload,
  AgentSettings,
} from '@core/primitives/agents/api';
import type {
  AppSettings,
  AppSettingsKey,
  ProviderCustomConfig,
} from '@core/primitives/app-settings/api';
import type {
  LegacyImportSource,
  LegacyPortPreview,
} from '@core/primitives/legacy-port/api/legacy-port';
import type { StartupDataGateStatus } from '@core/primitives/legacy-port/api/startup-data-gate';
import type { ProjectSettingsLoadResult } from '@core/primitives/project-settings/api';
import type { PromptLibraryPrompt } from '@core/primitives/prompt-library/api';
import type { ProviderRepositoryResult } from '@core/primitives/repository/api';
import type {
  CommandPaletteQuery,
  SearchItem,
  WorkspaceFileHit,
  WorkspaceFileSearchQuery,
} from '@core/primitives/search/api';
import type {
  MeasureProjectWorkspacesInput,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspacesResult,
} from '@core/primitives/workspaces/api';

type AccountUser = {
  userId: string;
  name?: string;
  username: string;
  avatarUrl: string;
  email: string;
};

type ProviderAccount = {
  providerId: string;
  providerAccountId: string;
  host: string;
  login: string;
  avatarUrl: string;
};

type AccountSession = {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
};

type AccountResult = {
  success: boolean;
  user?: AccountUser;
  provider?: string;
  providerAccountStatus?: string;
  providerAccount?: ProviderAccount;
  code?: string;
  error?: string;
};

const optionalConnectionId = z.object({ connectionId: z.string().optional() });

export const agentsContract = defineContract({
  list: procedure({
    input: optionalConnectionId,
    output: z.custom<AgentPayload[]>(),
  }),
  get: procedure({
    input: z.object({ id: z.string(), connectionId: z.string().optional() }),
    output: z.custom<AgentPayload | null>(),
  }),
  listAgentInstallationStatus: procedure({
    input: optionalConnectionId,
    output: z.custom<AgentInstallationStatus[]>(),
  }),
  install: procedure({
    input: z.object({
      id: z.string(),
      connectionId: z.string().optional(),
      method: z.unknown().optional(),
    }),
    output: z.unknown(),
  }),
  update: procedure({
    input: z.object({
      id: z.string(),
      connectionId: z.string().optional(),
      method: z.unknown().optional(),
    }),
    output: z.unknown(),
  }),
  uninstall: procedure({
    input: z.object({
      id: z.string(),
      connectionId: z.string().optional(),
      method: z.unknown().optional(),
    }),
    output: z.unknown(),
  }),
  getDefaultSettings: procedure({
    input: z.object({ id: z.string() }),
    output: z.custom<ProviderCustomConfig>(),
  }),
  getSettings: procedure({
    input: z.object({ id: z.string() }),
    output: z.custom<AgentSettings>(),
  }),
  updateSettings: procedure({
    input: z.object({ id: z.string(), config: z.custom<Partial<ProviderCustomConfig>>() }),
    output: z.void(),
  }),
  setUsedInstallation: procedure({
    input: z.object({
      id: z.string(),
      connectionId: z.string().optional(),
      selection: z.unknown().optional(),
    }),
    output: z.void(),
  }),
  probeOverride: procedure({
    input: z.object({
      id: z.string(),
      selection: z.object({ path: z.string().optional(), cli: z.string().optional() }),
      connectionId: z.string().optional(),
    }),
    output: z.null(),
  }),
  refreshLatestVersion: procedure({
    input: z.object({ id: z.string(), connectionId: z.string().optional() }),
    output: z.void(),
  }),
  probeAll: procedure({ input: optionalConnectionId, output: z.void() }),
});

export const accountContract = defineContract({
  getSession: procedure({ input: z.void(), output: z.custom<AccountSession>() }),
  signIn: procedure({
    input: z.object({ provider: z.string().optional() }),
    output: z.custom<AccountResult>(),
  }),
  linkProviderAccount: procedure({
    input: z.object({ provider: z.string().optional() }),
    output: z.custom<AccountResult>(),
  }),
  signOut: procedure({ input: z.void(), output: z.custom<AccountResult>() }),
  checkHealth: procedure({ input: z.void(), output: z.boolean() }),
});

export const appSettingsContract = defineContract({
  get: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>() }),
    output: z.custom<AppSettings[AppSettingsKey]>(),
  }),
  getAll: procedure({ input: z.void(), output: z.custom<AppSettings>() }),
  getWithMeta: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>() }),
    output: z.custom<{
      value: AppSettings[AppSettingsKey];
      defaults: AppSettings[AppSettingsKey];
      overrides: Partial<AppSettings[AppSettingsKey]>;
    }>(),
  }),
  update: procedure({
    input: z.object({
      key: z.custom<AppSettingsKey>(),
      value: z.custom<AppSettings[AppSettingsKey]>(),
    }),
    output: z.void(),
  }),
  reset: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>() }),
    output: z.void(),
  }),
  resetField: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>(), field: z.string() }),
    output: z.void(),
  }),
});

export const telemetryContract = defineContract({
  capture: procedure({
    input: z.object({
      event: z.string(),
      properties: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.void(),
  }),
  getStatus: procedure({
    input: z.void(),
    output: z.object({
      status: z.object({
        enabled: z.boolean(),
        envDisabled: z.boolean(),
        userOptOut: z.boolean(),
        hasKeyAndHost: z.boolean(),
        session_id: z.string().nullable(),
        instance_id: z.string().nullable(),
      }),
    }),
  }),
  setEnabled: procedure({ input: z.object({ enabled: z.boolean() }), output: z.void() }),
  getFeatureFlags: procedure({
    input: z.void(),
    output: z.record(z.string(), z.boolean()),
  }),
});

export const searchContract = defineContract({
  commandPalette: procedure({
    input: z.custom<CommandPaletteQuery>(),
    output: z.custom<SearchItem[]>(),
  }),
  searchWorkspaceFiles: procedure({
    input: z.custom<WorkspaceFileSearchQuery>(),
    output: z.custom<WorkspaceFileHit[]>(),
  }),
});

export const promptLibraryContract = defineContract({
  get: procedure({ input: z.void(), output: z.custom<PromptLibraryPrompt[]>() }),
  update: procedure({
    input: z.object({ prompts: z.custom<PromptLibraryPrompt[]>() }),
    output: z.void(),
  }),
});

export const repositoryContract = defineContract({
  resolveProvider: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProviderRepositoryResult>(),
  }),
});

export const projectSettingsContract = defineContract({
  getSettings: procedure({
    input: z.object({ workspaceId: z.string() }),
    output: z.custom<ProjectSettingsLoadResult>(),
  }),
});

export const projectWorkspacesContract = defineContract({
  listProjectWorkspaces: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProjectWorkspacesResult>(),
  }),
  measureProjectWorkspaces: procedure({
    input: z.custom<MeasureProjectWorkspacesInput>(),
    output: z.custom<MeasureProjectWorkspacesResult>(),
  }),
  deleteProjectWorkspaces: procedure({
    input: z.object({ projectId: z.string(), paths: z.array(z.string()) }),
    output: z.custom<ProjectWorkspaceActionSummary>(),
  }),
});

const editorBufferLocation = z.object({
  projectId: z.string(),
  workspaceId: z.string(),
  filePath: z.string(),
});

export const editorContract = defineContract({
  saveBuffer: procedure({
    input: editorBufferLocation.extend({ content: z.string() }),
    output: z.void(),
  }),
  clearBuffer: procedure({ input: editorBufferLocation, output: z.void() }),
  listBuffers: procedure({
    input: z.object({ projectId: z.string(), workspaceId: z.string() }),
    output: z.array(z.object({ filePath: z.string(), content: z.string() })),
  }),
});

export const legacyPortContract = defineContract({
  checkStatus: procedure({
    input: z.void(),
    output: z.custom<{
      hasLegacyDb: boolean;
      hasBetaDb: boolean;
      hasImportSources: boolean;
      portStatus: StartupDataGateStatus | null;
      hasExistingData: boolean;
    }>(),
  }),
  getPreview: procedure({ input: z.void(), output: z.custom<LegacyPortPreview>() }),
  runImport: procedure({
    input: z.object({
      sources: z.array(z.custom<LegacyImportSource>()).optional(),
      conflictChoices: z.record(z.string(), z.custom<LegacyImportSource>()).optional(),
    }),
    output: z.custom<{ success: boolean; error?: string }>(),
  }),
});
