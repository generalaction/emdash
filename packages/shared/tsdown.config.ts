import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    result: 'src/result/index.ts',
    scheduling: 'src/scheduling/index.ts',
    concurrency: 'src/concurrency/index.ts',
    util: 'src/util/index.ts',
    testing: 'src/testing/index.ts',
    config: 'src/config/index.ts',
    logger: 'src/logger/index.ts',
    'logger-context': 'src/logger/context.ts',
    'logger-context-node': 'src/logger/context-node.ts',
    'logger-node': 'src/logger/node/index.ts',
    'logger-pino': 'src/logger/pino/index.ts',
    'logger-transport': 'src/logger/transport/index.ts',
    markdown: 'src/markdown/index.ts',
    plugins: 'src/plugins/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['pino', 'fast-redact', 'zod'],
  },
  sourcemap: true,
  clean: true,
});
