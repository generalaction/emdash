import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    result: 'src/result/index.ts',
    logger: 'src/logger/index.ts',
    'logger-pino': 'src/logger/pino/index.ts',
    'logger-transport': 'src/logger/transport/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['pino', 'fast-redact'],
  },
  sourcemap: true,
  clean: true,
});
