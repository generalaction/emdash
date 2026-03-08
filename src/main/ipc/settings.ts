import { createRPCController } from '../../shared/ipc/rpc';
import { getAppSettings, updateAppSettings, type AppSettingsUpdate } from '../core/settings';

export const appSettingsController = createRPCController({
  get: () => getAppSettings(),
  update: (partial: AppSettingsUpdate) => updateAppSettings(partial ?? {}),
});
