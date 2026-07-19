import { createController, type Controller } from '@emdash/wire/api';
import { appSettingsOperations } from '@main/core/settings/controller';
import { appSettingsContract } from '../api';

export function createAppSettingsWireController(): Controller {
  return createController(appSettingsContract, {
    get: ({ key }) => appSettingsOperations.get(key),
    getAll: () => appSettingsOperations.getAll(),
    getWithMeta: ({ key }) => appSettingsOperations.getWithMeta(key),
    update: ({ key, value }) => appSettingsOperations.update(key, value),
    reset: ({ key }) => appSettingsOperations.reset(key),
    resetField: ({ key, field }) => appSettingsOperations.resetField(key, field),
  });
}
