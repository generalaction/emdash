import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

import {
  clearBootFailureMarker,
  clearBootMarkerIfStillBooting,
  describeCrashLoop,
  observePreviousBoot,
  recordBootFailure,
  writeBootingMarker,
} from './boot-guard';

const productionConfig = {
  isDev: false,
} as AppConfig;
const unfinishedLaunch = expect.stringContaining('ended before startup finished');

describe('boot guard', () => {
  beforeEach(() => {
    mocks.userDataPath = testUserDataPath;
    rmSync(mocks.userDataPath, { recursive: true, force: true });
    mkdirSync(mocks.userDataPath, { recursive: true });
  });

  it('counts a dirty marker from a crashed boot once', () => {
    writeBootingMarker(productionConfig);

    const crashed = { booting: false, failures: 1, lastFailure: unfinishedLaunch };
    expect(observePreviousBoot(productionConfig)).toEqual(crashed);
    expect(observePreviousBoot(productionConfig)).toEqual(crashed);
  });

  it('counts consecutive dirty boots', () => {
    writeBootingMarker(productionConfig);
    observePreviousBoot(productionConfig);
    writeBootingMarker(productionConfig);

    expect(observePreviousBoot(productionConfig)).toEqual({
      booting: false,
      failures: 2,
      lastFailure: unfinishedLaunch,
    });
  });

  it('clears the persisted state after success or a manual retry', () => {
    writeBootingMarker(productionConfig);
    clearBootFailureMarker();

    expect(existsSync(join(mocks.userDataPath, 'boot-state.json'))).toBe(false);
    expect(observePreviousBoot(productionConfig)).toEqual({ booting: false, failures: 0 });
  });

  it('counts an observed backend failure without waiting for the next launch', () => {
    writeBootingMarker(productionConfig);
    recordBootFailure(productionConfig, new Error('database disk image is malformed'));

    // The failure is already counted; the next launch must not double count.
    expect(observePreviousBoot(productionConfig)).toEqual({
      booting: false,
      failures: 1,
      lastFailure: 'database disk image is malformed',
    });
  });

  it('keeps recorded failures across a quit but clears an in-progress marker', () => {
    // Launch 1: backend fails, failure recorded, user quits the recovery window.
    writeBootingMarker(productionConfig);
    recordBootFailure(productionConfig, new Error('boom'));
    clearBootMarkerIfStillBooting();
    expect(observePreviousBoot(productionConfig)).toMatchObject({ booting: false, failures: 1 });

    // Launch 2: same again — two consecutive failures survive the quits.
    writeBootingMarker(productionConfig);
    recordBootFailure(productionConfig, new Error('boom'));
    clearBootMarkerIfStillBooting();
    expect(observePreviousBoot(productionConfig)).toMatchObject({ booting: false, failures: 2 });

    // A quit while still booting is a user abort, not a failure.
    writeBootingMarker(productionConfig);
    clearBootMarkerIfStillBooting();
    expect(observePreviousBoot(productionConfig)).toEqual({ booting: false, failures: 0 });
  });

  it('carries the most recent failure reason into the crash-loop message', () => {
    // Launch 1: the backend fails with a real error.
    writeBootingMarker(productionConfig);
    recordBootFailure(productionConfig, new Error('better-sqlite3 failed to load'));
    // Launch 2: boots past the guard and fails the same way.
    observePreviousBoot(productionConfig);
    writeBootingMarker(productionConfig);
    recordBootFailure(productionConfig, new Error('better-sqlite3 failed to load'));

    // Launch 3: the guard trips and recovery must still show the real cause.
    const previous = observePreviousBoot(productionConfig);
    expect(previous.failures).toBe(2);
    expect(describeCrashLoop(previous)).toBe(
      'Emdash entered recovery mode after 2 consecutive failed launches.\n\n' +
        'Most recent failure:\nbetter-sqlite3 failed to load'
    );
  });

  it('reports the most recent failure when a crash follows a recorded error', () => {
    writeBootingMarker(productionConfig);
    recordBootFailure(productionConfig, new Error('first launch error'));
    observePreviousBoot(productionConfig);
    // Launch 2 dies without reaching the failure handler.
    writeBootingMarker(productionConfig);

    expect(observePreviousBoot(productionConfig)).toEqual({
      booting: false,
      failures: 2,
      lastFailure: unfinishedLaunch,
    });
  });

  it('reads boot state written before failure reasons were recorded', () => {
    writeFileSync(
      join(mocks.userDataPath, 'boot-state.json'),
      JSON.stringify({ booting: false, failures: 2 })
    );

    const previous = observePreviousBoot(productionConfig);
    expect(previous).toEqual({ booting: false, failures: 2 });
    expect(describeCrashLoop(previous)).toBe(
      'Emdash entered recovery mode after 2 consecutive failed launches'
    );
  });

  it('is disabled in development', () => {
    const developmentConfig = { ...productionConfig, isDev: true };
    writeBootingMarker(developmentConfig);

    expect(existsSync(join(mocks.userDataPath, 'boot-state.json'))).toBe(false);
    expect(observePreviousBoot(developmentConfig)).toEqual({ booting: false, failures: 0 });
  });
});
