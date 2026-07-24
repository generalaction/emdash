import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './config';

const mocks = vi.hoisted(() => ({
  userDataPath: '',
}));
const testUserDataPath = join(tmpdir(), `emdash-boot-guard-${process.pid}`);

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userDataPath,
    once: () => {},
  },
}));

import { clearBootFailureMarker, observePreviousBoot, writeBootingMarker } from './boot-guard';

const productionConfig = {
  isDev: false,
} as AppConfig;

describe('boot guard', () => {
  beforeEach(() => {
    mocks.userDataPath = testUserDataPath;
    rmSync(mocks.userDataPath, { recursive: true, force: true });
    mkdirSync(mocks.userDataPath, { recursive: true });
  });

  it('counts a dirty marker from a crashed boot once', () => {
    writeBootingMarker(productionConfig);

    expect(observePreviousBoot(productionConfig)).toEqual({ booting: false, failures: 1 });
    expect(observePreviousBoot(productionConfig)).toEqual({ booting: false, failures: 1 });
  });

  it('counts consecutive dirty boots', () => {
    writeBootingMarker(productionConfig);
    observePreviousBoot(productionConfig);
    writeBootingMarker(productionConfig);

    expect(observePreviousBoot(productionConfig)).toEqual({ booting: false, failures: 2 });
  });

  it('clears the persisted state after success or a manual retry', () => {
    writeBootingMarker(productionConfig);
    clearBootFailureMarker();

    expect(existsSync(join(mocks.userDataPath, 'boot-state.json'))).toBe(false);
    expect(observePreviousBoot(productionConfig)).toEqual({ booting: false, failures: 0 });
  });

  it('is disabled in development', () => {
    const developmentConfig = { ...productionConfig, isDev: true };
    writeBootingMarker(developmentConfig);

    expect(existsSync(join(mocks.userDataPath, 'boot-state.json'))).toBe(false);
    expect(observePreviousBoot(developmentConfig)).toEqual({ booting: false, failures: 0 });
  });
});
