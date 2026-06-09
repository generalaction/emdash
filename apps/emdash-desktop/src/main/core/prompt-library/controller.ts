import { createRPCController } from '@shared/lib/ipc/rpc';
import { type PromptLibraryPrompt } from '@shared/prompt-library';
import { promptLibraryService } from './service';

export const promptLibraryController = createRPCController({
  get: (): Promise<PromptLibraryPrompt[]> => promptLibraryService.getPrompts(),
  update: (prompts: PromptLibraryPrompt[]): Promise<void> =>
    promptLibraryService.updatePrompts(prompts),
});
