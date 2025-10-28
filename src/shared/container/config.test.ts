import { describe, expect, it } from 'vitest';

import { ContainerConfigError, resolveContainerConfig, validateContainerConfig } from './config';

describe('resolveContainerConfig', () => {
  it('applies defaults when config is empty', () => {
    const config = resolveContainerConfig({});
    expect(config).toEqual({
      version: 1,
      packageManager: 'npm',
      start: 'npm run dev',
      envFile: undefined,
      workdir: '.',
      ports: [
        {
          service: 'app',
          container: 3000,
          protocol: 'tcp',
          preview: true,
        },
      ],
    });
  });

  it('uses inferred package manager when not set', () => {
    const config = resolveContainerConfig({}, { inferredPackageManager: 'pnpm' });
    expect(config.packageManager).toBe('pnpm');
  });

  it('normalises ports and enforces a single preview port', () => {
    const config = resolveContainerConfig({
      ports: [
        { service: 'web', container: 5173, preview: true },
        { service: 'api', container: 8080, preview: true },
      ],
    });

    expect(config.ports).toEqual([
      { service: 'web', container: 5173, protocol: 'tcp', preview: true },
      { service: 'api', container: 8080, protocol: 'tcp', preview: false },
    ]);
  });

  it('throws when duplicate services are provided', () => {
    expect(() =>
      resolveContainerConfig({
        ports: [
          { service: 'web', container: 3000 },
          { service: 'web', container: 3001 },
        ],
      })
    ).toThrow(ContainerConfigError);
  });

  it('rejects invalid package manager values', () => {
    expect(() =>
      resolveContainerConfig({
        packageManager: 'bun',
      })
    ).toThrow(/packageManager/);
  });
});

describe('validateContainerConfig', () => {
  it('wraps validation errors without throwing', () => {
    const result = validateContainerConfig({
      ports: [{ service: '', container: 3000 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ContainerConfigError);
      expect(result.error.path).toBe('ports[0].service');
    }
  });
});
