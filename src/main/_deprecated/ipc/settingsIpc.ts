import { createRPCController } from '../../../shared/ipc/rpc';
import { AppSettingsUpdate, getAppSettings, updateAppSettings } from '../../core/settings';

export const appSettingsController = createRPCController({
  get: async () => getAppSettings(),
  update: (partial: AppSettingsUpdate) => updateAppSettings(partial || {}),
});
