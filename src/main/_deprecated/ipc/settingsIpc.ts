import { AppSettingsUpdate, getAppSettings, updateAppSettings } from '../../core/settings';
import { createRPCController } from '../../../shared/ipc/rpc';

export const appSettingsController = createRPCController({
  get: async () => getAppSettings(),
  update: (partial: AppSettingsUpdate) => updateAppSettings(partial || {}),
});
