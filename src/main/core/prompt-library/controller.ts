import { createRPCController } from '@shared/ipc/rpc';
import { type PromptLibrary } from '@shared/prompt-library';
import { promptLibraryService } from './service';

export const promptLibraryController = createRPCController({
  get: (): Promise<PromptLibrary> => promptLibraryService.getLibrary(),
  update: (library: PromptLibrary): Promise<void> => promptLibraryService.updateLibrary(library),
});
