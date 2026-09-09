import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

describe('CSS-free controlled Theme runtime entry', () => {
  it('publishes the provider as an additive public subpath', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
    ) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports['./react/theme-runtime']).toEqual({
      types: './dist/src/react/theme-runtime.d.ts',
      default: './dist/react/theme-runtime.js',
    });
  });

  it('builds the runtime application seam without emitting CSS', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        lib: {
          entry: resolve(__dirname, 'theme-runtime.tsx'),
          formats: ['es'],
        },
        rollupOptions: {
          external: [/^@emdash\/theme(?:\/|$)/, /^react(?:\/|$)/],
        },
        write: false,
      },
    });
    const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
    const emittedCss = outputs
      .flatMap((output) => output.output)
      .filter((entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'));

    expect(emittedCss).toEqual([]);
  });
});
