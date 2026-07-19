import { createController, type Controller } from '@emdash/wire/api';
import { legacyPortOperations } from '@main/db/legacy-port/controller';
import { legacyPortContract } from '../api';

export function createLegacyPortWireController(): Controller {
  return createController(legacyPortContract, {
    checkStatus: () => legacyPortOperations.checkStatus(),
    getPreview: () => legacyPortOperations.getPreview(),
    runImport: (input) => legacyPortOperations.runImport(input),
  });
}
