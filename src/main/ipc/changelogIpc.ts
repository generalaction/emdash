import { createRPCController } from '../../shared/ipc/rpc';
import { changelogService } from '../services/ChangelogService';

export const changelogController = createRPCController({
  getLatestEntry: async (args?: { version?: string }) =>
    changelogService.getLatestEntry(args?.version),
});
