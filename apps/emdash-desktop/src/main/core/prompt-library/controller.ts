import { createRPCController } from '@shared/lib/ipc/rpc';
import { type PromptLibraryState } from '@shared/prompt-library';
import { promptLibraryService } from './service';

export const promptLibraryController = createRPCController({
  get: (): Promise<PromptLibraryState> => promptLibraryService.getState(),
  update: (state: PromptLibraryState): Promise<void> => promptLibraryService.updateState(state),
});
