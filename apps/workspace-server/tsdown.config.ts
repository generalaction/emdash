import { defineConfig } from 'tsdown';
import { workspaceWorkers } from './src/worker-manifest.js';
import { workspaceWorkerBuildInputs } from './worker-manifest-utils.js';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ...workspaceWorkerBuildInputs(workspaceWorkers),
  },
  format: ['esm'],
  outputOptions: {
    codeSplitting: true,
  },
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    alwaysBundle: [/.*/],
    neverBundle: ['node-pty', 'better-sqlite3', '@parcel/watcher'],
    onlyBundle: false,
  },
});
