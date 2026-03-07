import { AppSettingsUpdate, getAppSettings, updateAppSettings } from '../../_new/core/settings';
import { createRPCController } from '../../../shared/ipc/rpc';

export const appSettingsController = createRPCController({
  get: async () => getAppSettings(),
  update: (partial: AppSettingsUpdate) => updateAppSettings(partial || {}),
});
