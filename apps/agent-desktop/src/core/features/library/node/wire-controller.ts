import { createController, type Controller } from '@agent/wire/rpc';
import { promptLibraryContract } from '../api';
import type { PromptLibraryService } from './prompt-library-service';

export function createPromptLibraryWireController(service: PromptLibraryService): Controller {
  return createController(promptLibraryContract, {
    get: () => service.getPrompts(),
    update: ({ prompts }) => service.updatePrompts(prompts),
  });
}
