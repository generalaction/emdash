import { basename, extname } from 'node:path';
import { defineConfig } from 'tsdown';
import workspaceWorkers from './src/worker-manifest.json' with { type: 'json' };

function workspaceWorkerBuildInputs(): Record<string, string> {
  return Object.fromEntries(
    Object.values(workspaceWorkers).map((worker) => [
      basename(worker.file, extname(worker.file)),
      worker.entry,
    ])
  );
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ...workspaceWorkerBuildInputs(),
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['node-pty', 'zod'],
  },
});
