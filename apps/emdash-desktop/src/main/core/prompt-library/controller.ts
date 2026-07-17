import { type PromptLibraryPrompt } from '@core/primitives/prompt-library/api';
import { promptLibraryService } from './service';

export const promptLibraryOperations = {
  get: (): Promise<PromptLibraryPrompt[]> => promptLibraryService.getPrompts(),
  update: (prompts: PromptLibraryPrompt[]): Promise<void> =>
    promptLibraryService.updatePrompts(prompts),
};
