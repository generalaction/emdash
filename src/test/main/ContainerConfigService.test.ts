import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  ContainerConfigLoadError,
  loadWorkspaceContainerConfig,
} from '../../main/services/containerConfigService';

let tempDir: string;

function makeWorkspaceDir(name: string): string {
  const dir = path.join(tempDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-config-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('loadWorkspaceContainerConfig', () => {
  it('returns defaults when config file is missing', async () => {
    const workspace = makeWorkspaceDir('missing-config');
    fs.writeFileSync(path.join(workspace, 'pnpm-lock.yaml'), '', 'utf8');

    const result = await loadWorkspaceContainerConfig(workspace);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourcePath).toBeNull();
      expect(result.config.packageManager).toBe('pnpm');
      expect(result.config.start).toBe('npm run dev');
      expect(result.config.ports[0]).toMatchObject({ service: 'app', container: 3000, preview: true });
    }
  });

  it('parses config file and maintains overrides', async () => {
    const workspace = makeWorkspaceDir('custom-config');
    const configDir = path.join(workspace, '.emdash');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        packageManager: 'yarn',
        start: 'yarn dev',
        ports: [
          { service: 'dev', container: 5173, preview: true },
          { service: 'api', container: 8080 },
        ],
      }),
      'utf8'
    );

    const result = await loadWorkspaceContainerConfig(workspace);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourcePath).toContain(path.join('.emdash', 'config.json'));
      expect(result.config.packageManager).toBe('yarn');
      expect(result.config.start).toBe('yarn dev');
      expect(result.config.ports).toEqual([
        { service: 'dev', container: 5173, protocol: 'tcp', preview: true },
        { service: 'api', container: 8080, protocol: 'tcp', preview: false },
      ]);
    }
  });

  it('returns validation errors with context when config is invalid', async () => {
    const workspace = makeWorkspaceDir('invalid-config');
    const configDir = path.join(workspace, '.emdash');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        ports: [{ service: '', container: 3000 }],
      }),
      'utf8'
    );

    const result = await loadWorkspaceContainerConfig(workspace);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ContainerConfigLoadError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.configKey).toBe('ports[0].service');
      expect(result.error.configPath).toContain(path.join('.emdash', 'config.json'));
    }
  });

  it('surfaces invalid JSON errors', async () => {
    const workspace = makeWorkspaceDir('invalid-json');
    const configDir = path.join(workspace, '.emdash');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), '{ invalid', 'utf8');

    const result = await loadWorkspaceContainerConfig(workspace);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_JSON');
      expect(result.error.configPath).toContain(path.join('.emdash', 'config.json'));
    }
  });
});
