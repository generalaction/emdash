import { ok, type Result } from '@emdash/shared';
import { log } from '@main/lib/logger';
import type { WriteProjectConfigRequest } from '@shared/core/project-settings/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { ProjectProvider } from '../../project-provider';
import { errorMessage, writeConfigFailed } from './config-migration-utils';
import {
  resolveProjectSettingsTarget,
  type ProjectSettingsResolvedTarget,
} from './project-settings-target-resolver';
import {
  CONFIG_FILE,
  parseWorkspaceConfigObject,
  patchShareableProjectSettingsFields,
} from './workspace-config-file';

export async function shareProjectSettingsToConfig(
  project: ProjectProvider,
  request: WriteProjectConfigRequest,
  resolvedTargets: ProjectSettingsResolvedTarget[]
): Promise<Result<void, UpdateProjectSettingsError>> {
  try {
    const target = await resolveProjectSettingsTarget(project, request, resolvedTargets);
    if (!target) {
      return writeConfigFailed('Could not resolve the selected working copy.');
    }

    const localSettings = await project.settings.get();
    let config: Record<string, unknown>;
    try {
      const exists = await target.fileSystem.exists(target.configPath);
      if (!exists.success) {
        const message = `Could not check existing ${CONFIG_FILE}: ${exists.error.message}`;
        log.warn('Failed to check project config before writing', exists.error);
        return writeConfigFailed(message);
      }
      if (exists.data) {
        const content = await target.fileSystem.readText(target.configPath);
        if (!content.success) {
          const message = `Could not read existing ${CONFIG_FILE}: ${content.error.message}`;
          log.warn('Failed to read project config before writing', content.error);
          return writeConfigFailed(message);
        }
        if (content.data.truncated) {
          const message = `Could not read existing ${CONFIG_FILE}: file was truncated.`;
          log.warn('Project config was truncated before writing', {
            path: target.configPath,
            totalSize: content.data.totalSize,
          });
          return writeConfigFailed(message);
        }
        config = parseWorkspaceConfigObject(content.data.content);
      } else {
        config = {};
      }
    } catch (error) {
      const message = `Could not read existing ${CONFIG_FILE}: ${errorMessage(error)}`;
      log.warn('Failed to read project config before writing', error);
      return writeConfigFailed(message);
    }

    const writtenFields = patchShareableProjectSettingsFields(
      config,
      localSettings,
      request.fields
    );

    const written = await target.fileSystem.writeText(
      target.configPath,
      `${JSON.stringify(config, null, 2)}\n`
    );
    if (!written.success) {
      log.warn('Failed to write project config to repo', written.error);
      return writeConfigFailed(`Could not write ${CONFIG_FILE}: ${written.error.message}`);
    }

    const clearResult = await project.settings.patch({ clearShareableFields: writtenFields });
    if (!clearResult.success) {
      log.warn('Failed to clear shareable project settings', clearResult.error);
      return writeConfigFailed(
        `Wrote ${CONFIG_FILE}, but failed to clear shared project settings.`
      );
    }

    return ok();
  } catch (error) {
    log.warn('Failed to write project config to repo', error);
    return writeConfigFailed(errorMessage(error));
  }
}
