import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const existsSyncMock = vi.fn();
const renameSyncMock = vi.fn();
const getPathMock = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => existsSyncMock(...args),
  renameSync: (...args: any[]) => renameSyncMock(...args),
}));

vi.mock('electron', () => ({
  app: {
    getPath: (...args: any[]) => getPathMock(...args),
  },
}));

import { resolveDatabasePath } from '../../main/db/path';

describe('resolveDatabasePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EMDASH_DB_FILE;
    getPathMock.mockReturnValue('/tmp/emdash-user-data');
    existsSyncMock.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.EMDASH_DB_FILE;
  });

  it('uses EMDASH_DB_FILE override when set', () => {
    process.env.EMDASH_DB_FILE = './tmp/test-db/custom.db';

    const result = resolveDatabasePath();

    expect(result).toBe(path.resolve('./tmp/test-db/custom.db'));
    expect(getPathMock).not.toHaveBeenCalled();
  });

  it('falls back to userData path when no override is provided', () => {
    const result = resolveDatabasePath();

    expect(result).toBe('/tmp/emdash-user-data/emdash.db');
    expect(getPathMock).toHaveBeenCalledWith('userData');
  });
});
