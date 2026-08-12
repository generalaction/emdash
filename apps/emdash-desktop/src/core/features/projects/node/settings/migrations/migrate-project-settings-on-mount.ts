import { log } from '@emdash/shared/logger';
import type { Project } from '@core/primitives/projects/api';
import type { WorkspaceRegistryRuntimeClient } from '@core/services/runtime-broker/api/clients';
import type { ProjectSettingsMigrationReader } from './migration-reader';

export type ProjectSettingsMountMigrationOptions = {
  migrateAppWorktreeRoot?: () => Promise<void>;
};

export async function migrateProjectSettingsOnMount(
  project: Pick<Project, 'id' | 'repositoryWorkspaceId'>,
  settings: ProjectSettingsMigrationReader,
  workspaceRegistry: Pick<
    WorkspaceRegistryRuntimeClient,
    'getProjectConfig' | 'importLegacyLifecycleSettings'
  >,
  options: ProjectSettingsMountMigrationOptions = {}
): Promise<void> {
  if (options.migrateAppWorktreeRoot) {
    try {
      await options.migrateAppWorktreeRoot();
    } catch (error) {
      log.warn('App worktree-root migration failed; retrying when a project mounts', {
        projectId: project.id,
        error,
      });
    }
  }
  await settings.migrateAncientConfig();

  try {
    const legacy = await settings.readLegacyLifecycleSettings();
    if (!project.repositoryWorkspaceId) return;
    const current = await workspaceRegistry.getProjectConfig({
      workspaceId: project.repositoryWorkspaceId,
    });
    if (!current.success) return;
    if (current.data.legacyDesktopSettingsMigrated) {
      await settings.finalizeLegacyLifecycleSettings();
      return;
    }

    const migrated = await workspaceRegistry.importLegacyLifecycleSettings({
      workspaceId: project.repositoryWorkspaceId,
      settings: {
        ...(legacy.preservePatterns !== undefined
          ? { preservePatterns: legacy.preservePatterns }
          : {}),
        ...(legacy.scripts ? { scripts: legacy.scripts } : {}),
        ...(legacy.autoRunSetup !== undefined ? { autoRunSetup: legacy.autoRunSetup } : {}),
        ...(legacy.autoRunRun !== undefined ? { autoRunRun: legacy.autoRunRun } : {}),
      },
    });
    if (!migrated.success) {
      log.warn(
        'Host rejected the lifecycle settings migration; retrying when the project reopens',
        {
          projectId: project.id,
          error: migrated.error,
        }
      );
      return;
    }
    if (!migrated.data.legacyDesktopSettingsMigrated) {
      log.warn(
        'Host did not confirm the lifecycle settings migration; retrying when the project reopens',
        { projectId: project.id }
      );
      return;
    }
    await settings.finalizeLegacyLifecycleSettings();
  } catch (error) {
    // Project mounting remains available; the absent completion marker retries next open.
    log.warn('Lifecycle settings migration failed; retrying when the project reopens', {
      projectId: project.id,
      error,
    });
  }
}
