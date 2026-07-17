import { createRPCController } from '@shared/lib/ipc/rpc';
import { browseDirectory } from './browse-directory';

export const machineFilesController = createRPCController({
  browseDirectory,
});
