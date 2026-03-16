import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock keytar
vi.mock('keytar', () => ({
  setPassword: vi.fn().mockResolvedValue(undefined),
  getPassword: vi.fn().mockResolvedValue(null),
  deletePassword: vi.fn().mockResolvedValue(true),
}));

// Mock electron (including net.fetch used by validateSession/checkServerHealth)
const mockNetFetch = vi.fn();
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/emdash-test'),
    isPackaged: false,
  },
  net: {
    fetch: mockNetFetch,
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('{}'),
    existsSync: vi.fn().mockReturnValue(false),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

async function freshImport() {
  vi.resetModules();
  const fsModule = await import('fs');
  const keytarModule = await import('keytar');
  const { emdashAccountService } = await import('../../main/services/EmdashAccountService');
  return {
    emdashAccountService,
    fs: fsModule,
    keytar: keytarModule,
  };
}

describe('EmdashAccountService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return hasAccount: false when no profile cache exists', async () => {
    const { emdashAccountService } = await freshImport();
    const session = emdashAccountService.getSession();
    expect(session.hasAccount).toBe(false);
    expect(session.isSignedIn).toBe(false);
    expect(session.user).toBeNull();
  });

  it('should return hasAccount: true when profile cache exists', async () => {
    const { emdashAccountService, fs } = await freshImport();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        hasAccount: true,
        userId: 'user_123',
        username: 'testuser',
        avatarUrl: 'https://example.com/avatar.png',
        email: 'test@example.com',
        lastValidated: '2026-03-13T00:00:00.000Z',
      })
    );

    const session = emdashAccountService.getSession();
    expect(session.hasAccount).toBe(true);
    expect(session.isSignedIn).toBe(false); // no session token loaded
    expect(session.user).toBeNull();
  });

  it('should validate session successfully', async () => {
    const { emdashAccountService, fs, keytar } = await freshImport();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        hasAccount: true,
        userId: 'user_123',
        username: 'testuser',
        avatarUrl: '',
        email: 'test@example.com',
        lastValidated: '2026-03-13T00:00:00.000Z',
      })
    );
    vi.mocked(keytar.getPassword).mockResolvedValue('session_token_123');

    mockNetFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: { token: 'session_token_123' }, user: { id: 'user_123' } }),
    });

    await emdashAccountService.loadSessionToken();
    const valid = await emdashAccountService.validateSession();
    expect(valid).toBe(true);
  });

  it('should handle auth server being unreachable gracefully', async () => {
    const { emdashAccountService, keytar } = await freshImport();
    vi.mocked(keytar.getPassword).mockResolvedValue('session_token_123');
    mockNetFetch.mockRejectedValueOnce(new Error('fetch failed'));

    await emdashAccountService.loadSessionToken();
    const valid = await emdashAccountService.validateSession();
    // Should not invalidate — server unreachable, trust cached state
    expect(valid).toBe(true);
  });

  it('should clear session on sign out but keep hasAccount', async () => {
    const { emdashAccountService, fs, keytar } = await freshImport();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        hasAccount: true,
        userId: 'user_123',
        username: 'testuser',
        avatarUrl: '',
        email: 'test@example.com',
        lastValidated: '2026-03-13T00:00:00.000Z',
      })
    );
    vi.mocked(keytar.getPassword).mockResolvedValue('session_token_123');

    await emdashAccountService.loadSessionToken();
    await emdashAccountService.signOut();

    expect(keytar.deletePassword).toHaveBeenCalledWith('emdash-account', 'session-token');
    const session = emdashAccountService.getSession();
    expect(session.isSignedIn).toBe(false);
    expect(session.hasAccount).toBe(true); // hasAccount stays true after sign-out
  });
});
