import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureUserBinDirsInPath, ensureWindowsNpmGlobalBinInPath } from './userEnv';

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

describe('ensureUserBinDirsInPath', () => {
  it('prepends existing user bin directories to process PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-user-bin-'));
    process.env.PATH = '/usr/bin';

    const added = ensureUserBinDirsInPath([dir]);

    expect(added).toEqual([dir]);
    expect(process.env.PATH?.split(path.delimiter).slice(0, 2)).toEqual([dir, '/usr/bin']);
  });

  it('does not duplicate existing path entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-user-bin-'));
    process.env.PATH = [dir, '/usr/bin'].join(path.delimiter);

    const added = ensureUserBinDirsInPath([dir]);

    expect(added).toEqual([]);
    expect(process.env.PATH).toBe([dir, '/usr/bin'].join(path.delimiter));
  });
});

describe('ensureWindowsNpmGlobalBinInPath', () => {
  it('uses APPDATA case-insensitively when prepending npm global bin', () => {
    const env: NodeJS.ProcessEnv = {
      appdata: 'C:\\Users\\test\\AppData\\Roaming',
      Path: 'C:\\Windows\\System32',
    };

    const added = ensureWindowsNpmGlobalBinInPath(env);

    expect(added).toBe('C:\\Users\\test\\AppData\\Roaming\\npm');
    expect(env.Path).toBe('C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Windows\\System32');
  });
});
