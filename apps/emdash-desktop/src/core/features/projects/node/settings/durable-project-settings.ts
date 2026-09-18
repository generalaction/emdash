import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  ProjectDurableSettingsDomains,
  ProjectIntegrationAccountsPatch,
  ProjectSettingsDomainPatch,
} from '@core/features/projects/api/project-settings-page';
import type { StoredBaseProjectSettings } from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import {
  readStoredProjectSettings,
  serializeStoredProjectSettings,
} from './migrations/stored-settings';
import { ProjectSettingsRepository, type ProjectSettingsStorage } from './project-settings-storage';

export interface DurableProjectSettingsAuthority {
  read(
    projectId: string
  ): Promise<Result<ProjectDurableSettingsDomains, UpdateProjectSettingsError>>;
  patch(
    projectId: string,
    patch: Pick<ProjectSettingsDomainPatch, 'gitIdentity' | 'integrationAccounts' | 'placement'>
  ): Promise<Result<void, UpdateProjectSettingsError>>;
}

export class DesktopProjectSettingsAuthority implements DurableProjectSettingsAuthority {
  constructor(private readonly storage: ProjectSettingsStorage) {}

  async read(
    projectId: string
  ): Promise<Result<ProjectDurableSettingsDomains, UpdateProjectSettingsError>> {
    try {
      const stored = await this.readStored(projectId);
      return ok(durableDomains(stored));
    } catch (error) {
      log.warn('Failed to read durable Project settings', { projectId, error });
      return err({ type: 'invalid-settings' });
    }
  }

  async patch(
    projectId: string,
    patch: Pick<ProjectSettingsDomainPatch, 'gitIdentity' | 'integrationAccounts' | 'placement'>
  ): Promise<Result<void, UpdateProjectSettingsError>> {
    try {
      await this.storage.insertIfMissing(projectId, {
        baseProjectSettingsJson: '{}',
        shareableProjectSettingsJson: '{}',
        legacyConfigMigratedAt: null,
      });
      await this.storage.mutate(projectId, (row) => {
        const next = readStoredProjectSettings(row.baseProjectSettingsJson);
        const git = patch.gitIdentity?.stored;
        if (git) {
          for (const field of [
            'defaultBranch',
            'baseRemote',
            'pushRemote',
            'agentGitCredentials',
          ] as const) {
            if (!Object.hasOwn(git, field)) continue;
            const value = git[field];
            if (value === null || value === undefined) delete next[field];
            else next[field] = value as never;
          }
        }
        applyIntegrationAccountsPatch(next, patch.integrationAccounts?.stored);
        const tmux = patch.placement?.stored.tmux;
        if (patch.placement && Object.hasOwn(patch.placement.stored, 'tmux')) {
          next.tmuxDefaultMigrated = true;
          if (tmux === null || tmux === undefined) delete next.tmux;
          else next.tmux = tmux;
        }

        return {
          baseProjectSettingsJson: serializeStoredProjectSettings(
            next,
            row.baseProjectSettingsJson
          ),
        };
      });
      return ok();
    } catch (error) {
      log.warn('Failed to patch durable Project settings', { projectId, error });
      return err({ type: 'error' });
    }
  }

  private async readStored(projectId: string) {
    const row = await this.storage.get(projectId);
    if (!row) return {};
    return readStoredProjectSettings(row.baseProjectSettingsJson);
  }
}

export function createDesktopProjectSettingsAuthority(
  db: ConstructorParameters<typeof ProjectSettingsRepository>[0]
): DesktopProjectSettingsAuthority {
  return new DesktopProjectSettingsAuthority(new ProjectSettingsRepository(db));
}

/**
 * Applies the per-provider merge patch over the stored account overrides:
 * value sets, `null` clears, absent keys stay; an empty result map is stored
 * as absence.
 */
export function applyIntegrationAccountsPatch(
  next: StoredBaseProjectSettings,
  patch: ProjectIntegrationAccountsPatch | undefined
): void {
  if (patch === undefined) return;
  const merged = { ...(next.integrationAccounts ?? {}) };
  for (const [providerId, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete merged[providerId];
    else merged[providerId] = value;
  }
  if (Object.keys(merged).length === 0) delete next.integrationAccounts;
  else next.integrationAccounts = merged;
}

function durableDomains(stored: StoredBaseProjectSettings): ProjectDurableSettingsDomains {
  const {
    worktreeRoot,
    tmux,
    integrationAccounts,
    tmuxDefaultMigrated: _migration,
    ...gitIdentity
  } = stored;
  return {
    gitIdentity: { stored: gitIdentity },
    integrationAccounts: { stored: integrationAccounts ?? {} },
    placement: {
      stored: {
        ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
        ...(tmux !== undefined ? { tmux } : {}),
      },
    },
  };
}
