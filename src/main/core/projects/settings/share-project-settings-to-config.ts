import type { WriteProjectConfigRequest } from '@shared/project-settings';
import { clearShareableProjectSettingsFields } from '@shared/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { log } from '@main/lib/logger';
import type { ProjectProvider } from '../project-provider';
import {
  resolveProjectSettingsTarget,
  type ProjectSettingsResolvedTarget,
} from './project-settings-target-resolver';
import {
  CONFIG_FILE,
  parseWorkspaceConfigObject,
  patchShareableProjectSettingsFields,
} from './workspace-config-file';

function writeConfigFailed(message: string): Result<void, UpdateProjectSettingsError> {
  return err({ type: 'write-config-failed', message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
      config = (await target.fs.exists(CONFIG_FILE))
        ? parseWorkspaceConfigObject((await target.fs.read(CONFIG_FILE)).content)
        : {};
    } catch (error) {
      const message = `Could not read existing ${CONFIG_FILE}: ${errorMessage(error)}`;
      log.warn('Failed to read project config before writing', error);
      return writeConfigFailed(message);
    }

    patchShareableProjectSettingsFields(config, localSettings, request.fields);

    const writeResult = await target.fs.write(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
    if (!writeResult.success) {
      log.warn('Failed to write project config file', writeResult.error);
      return writeConfigFailed(writeResult.error ?? `Failed to write ${CONFIG_FILE}.`);
    }

    const clearResult = await project.settings.update(
      clearShareableProjectSettingsFields(localSettings, request.fields)
    );
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
