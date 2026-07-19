import { defineConfig } from 'tsdown';
import { workspaceWorkers } from './src/worker-manifest.js';
import { workspaceWorkerBuildInputs } from './worker-manifest-utils.js';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ...workspaceWorkerBuildInputs(workspaceWorkers),
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['node-pty', 'zod'],
  },
});
