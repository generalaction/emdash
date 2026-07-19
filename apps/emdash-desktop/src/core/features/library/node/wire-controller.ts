import { createController, type Controller } from '@emdash/wire/api';
import { promptLibraryOperations } from '@main/core/prompt-library/controller';
import { promptLibraryContract } from '../api';

export function createPromptLibraryWireController(): Controller {
  return createController(promptLibraryContract, {
    get: () => promptLibraryOperations.get(),
    update: ({ prompts }) => promptLibraryOperations.update(prompts),
  });
}
