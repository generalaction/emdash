import { createController, type Controller } from '@emdash/wire/api';
import { promptLibraryContract } from '../api';
import { promptLibraryService } from './prompt-library-service';

export function createPromptLibraryWireController(): Controller {
  return createController(promptLibraryContract, {
    get: () => promptLibraryService.getPrompts(),
    update: ({ prompts }) => promptLibraryService.updatePrompts(prompts),
  });
}
