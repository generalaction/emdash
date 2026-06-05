import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubConnectionServiceImpl } from './github-connection-service';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockGetSecret = vi.fn();
const mockSetSecret = vi.fn();
const mockDeleteSecret = vi.fn();
vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: (...args: unknown[]) => mockGetSecret(...args),
    setSecret: (...args: unknown[]) => mockSetSecret(...args),
    deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  },
}));

const mockKvGet = vi.fn();
const mockKvSet = vi.fn();
const mockKvDel = vi.fn();
vi.mock('@main/db/kv', () => ({
  KV: class {
    get(...args: unknown[]) {
      return mockKvGet(...args);
    }
    set(...args: unknown[]) {
      return mockKvSet(...args);
    }
    del(...args: unknown[]) {
      return mockKvDel(...args);
    }
  },
}));

const mockExtractGhCliToken = vi.fn();
vi.mock('./gh-cli-token', () => ({
  extractGhCliToken: (...args: unknown[]) => mockExtractGhCliToken(...args),
}));

vi.mock('@main/core/execution-context/local-execution-context', () => ({
  LocalExecutionContext: class {
    root = undefined;
    supportsLocalSpawn = false;
    exec = vi.fn();
    execStreaming = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubConnectionServiceImpl token caching', () => {
  let service: GitHubConnectionServiceImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    service = new GitHubConnectionServiceImpl();
    mockGetSecret.mockResolvedValue(null);
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue(undefined);
    mockKvDel.mockResolvedValue(undefined);
    mockSetSecret.mockResolvedValue(undefined);
    mockDeleteSecret.mockResolvedValue(undefined);
    mockExtractGhCliToken.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the token and hits the keychain only once while cache is warm', async () => {
    mockGetSecret.mockResolvedValue('gho_token123');
    mockKvGet.mockResolvedValue('secure_storage');

    const t1 = await service.getToken();
    const t2 = await service.getToken();

    expect(t1).toBe('gho_token123');
    expect(t2).toBe('gho_token123');
    expect(mockGetSecret).toHaveBeenCalledTimes(1);
  });

  it('reads stored token records without probing GitHub CLI', async () => {
    mockGetSecret.mockResolvedValue('gho_stored');
    mockKvGet.mockResolvedValue('cli');
    mockExtractGhCliToken.mockResolvedValue('gho_cli');

    await expect(service.getStoredTokenRecord()).resolves.toEqual({
      token: 'gho_stored',
      source: 'cli',
    });

    expect(mockExtractGhCliToken).not.toHaveBeenCalled();
  });

  it('returns null for stored token records when only GitHub CLI is available', async () => {
    mockGetSecret.mockResolvedValue(null);
    mockExtractGhCliToken.mockResolvedValue('gho_cli');

    await expect(service.getStoredTokenRecord()).resolves.toBeNull();

    expect(mockExtractGhCliToken).not.toHaveBeenCalled();
  });

  it('concurrent getToken() calls share one in-flight resolution', async () => {
    let resolve!: (v: string) => void;
    const pending = new Promise<string>((res) => {
      resolve = res;
    });
    mockGetSecret.mockReturnValue(pending);
    mockKvGet.mockResolvedValue('secure_storage');

    const p1 = service.getToken();
    const p2 = service.getToken();
    resolve('gho_shared');

    const [t1, t2] = await Promise.all([p1, p2]);

    expect(t1).toBe('gho_shared');
    expect(t2).toBe('gho_shared');
    expect(mockGetSecret).toHaveBeenCalledTimes(1);
  });

  it('storeToken() invalidates the cache so the next getToken() re-reads the keychain', async () => {
    mockGetSecret.mockResolvedValueOnce('gho_old').mockResolvedValue('gho_new');
    mockKvGet.mockResolvedValue('secure_storage');

    await service.getToken();
    await service.storeToken('gho_new');
    const token = await service.getToken();

    expect(token).toBe('gho_new');
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });

  it('logout() invalidates the cache so the next getToken() re-reads the keychain', async () => {
    mockGetSecret.mockResolvedValueOnce('gho_token').mockResolvedValue(null);
    mockKvGet.mockResolvedValue('secure_storage');

    await service.getToken();
    await service.logout();
    const token = await service.getToken();

    expect(token).toBeNull();
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });

  it('re-resolves after the 5-minute TTL expires', async () => {
    mockGetSecret.mockResolvedValue('gho_token');
    mockKvGet.mockResolvedValue('secure_storage');

    await service.getToken();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await service.getToken();

    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });

  it('does not re-resolve before the TTL expires', async () => {
    mockGetSecret.mockResolvedValue('gho_token');
    mockKvGet.mockResolvedValue('secure_storage');

    await service.getToken();
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    await service.getToken();

    expect(mockGetSecret).toHaveBeenCalledTimes(1);
  });

  it('keeps CLI-sourced getToken() cached while the TTL is warm', async () => {
    mockGetSecret.mockResolvedValue('gho_cached_cli');
    mockKvGet.mockResolvedValue('cli');
    mockExtractGhCliToken.mockResolvedValue('gho_cached_cli');

    const first = await service.getToken();
    const second = await service.getToken();

    expect(first).toBe('gho_cached_cli');
    expect(second).toBe('gho_cached_cli');
    expect(mockExtractGhCliToken).toHaveBeenCalledTimes(1);
  });

  it('force-refreshes CLI-sourced status when requested', async () => {
    mockGetSecret.mockResolvedValue('gho_stale_cli');
    mockKvGet.mockResolvedValue('cli');
    mockExtractGhCliToken.mockResolvedValueOnce('gho_stale_cli').mockResolvedValueOnce(null);

    await service.getToken();
    const status = await service.getStatus({ refresh: true });

    expect(status).toEqual({ authenticated: false, user: null, tokenSource: null });
    expect(mockExtractGhCliToken).toHaveBeenCalledTimes(2);
    expect(mockDeleteSecret).toHaveBeenCalledWith('emdash-github-token');
    expect(mockKvDel).toHaveBeenCalledWith('tokenSource');
  });

  it('getStatus({ refresh: true }) detects GitHub CLI after a cached miss', async () => {
    const user = {
      id: 1,
      login: 'octocat',
      name: 'Octocat',
      email: '',
      avatar_url: 'https://github.com/octocat.png',
    };
    mockExtractGhCliToken.mockResolvedValueOnce(null).mockResolvedValueOnce('gho_cli');
    vi.spyOn(service, 'getUserInfo').mockResolvedValue(user);

    await service.getToken();
    const status = await service.getStatus({ refresh: true });

    expect(status).toEqual({ authenticated: true, user, tokenSource: 'cli' });
    expect(mockSetSecret).toHaveBeenCalledWith('emdash-github-token', 'gho_cli');
    expect(mockKvSet).toHaveBeenCalledWith('tokenSource', 'cli');
  });
});
