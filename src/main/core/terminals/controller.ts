import { createRPCController } from '@shared/ipc/rpc';
import { createTerminal } from './createTerminal';
import { deleteTerminal } from './deleteTerminal';
import { getAllTerminals } from './getAllTerminals';
import { renameTerminal } from './renameTerminal';

export const terminalsController = createRPCController({
  getAllTerminals,
  createTerminal,
  deleteTerminal,
  renameTerminal,
});
