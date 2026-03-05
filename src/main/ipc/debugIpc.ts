import { dirname } from 'node:path';
import * as fs from 'node:fs';
import { createRPCController } from '../../shared/ipc/rpc';

export const debugController = createRPCController({
  appendLog: async (filePath: string, content: string, options: { reset?: boolean } = {}) => {
    try {
      if (!filePath) throw new Error('filePath is required');

      const dir = dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });

      const flag = options.reset ? 'w' : 'a';
      await fs.promises.writeFile(filePath, content, { flag, encoding: 'utf8' });
      return { success: true };
    } catch (error) {
      console.error('Failed to append debug log:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
});
