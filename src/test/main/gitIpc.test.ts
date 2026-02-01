import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

import {
  parseGitHubOwnerFromRemoteUrl,
  parseGitHubRepoFromRemoteUrl,
  registerGitIpc,
} from '../../main/ipc/gitIpc';

const GITHUB_REMOTE_URL_CASES: Array<{
  url: string;
  owner: string;
  nameWithOwner: string;
}> = [
  {
    url: 'https://github.com/generalaction/emdash.git',
    owner: 'generalaction',
    nameWithOwner: 'generalaction/emdash',
  },
  {
    url: 'https://github.com/generalaction/emdash',
    owner: 'generalaction',
    nameWithOwner: 'generalaction/emdash',
  },
  {
    url: 'git@github.com:generalaction/emdash.git',
    owner: 'generalaction',
    nameWithOwner: 'generalaction/emdash',
  },
  {
    url: 'ssh://git@github.com/generalaction/emdash.git',
    owner: 'generalaction',
    nameWithOwner: 'generalaction/emdash',
  },
  {
    url: 'github.com/generalaction/emdash',
    owner: 'generalaction',
    nameWithOwner: 'generalaction/emdash',
  },
];

describe('parseGitHubOwnerFromRemoteUrl', () => {
  it.each(GITHUB_REMOTE_URL_CASES)('returns owner for $url', ({ url, owner }) => {
    expect(parseGitHubOwnerFromRemoteUrl(url)).toBe(owner);
  });

  it('returns null for non-GitHub URL', () => {
    expect(parseGitHubOwnerFromRemoteUrl('https://example.com/foo')).toBeNull();
  });
});

describe('parseGitHubRepoFromRemoteUrl', () => {
  it.each(GITHUB_REMOTE_URL_CASES)(
    'returns owner and nameWithOwner for $url',
    ({ url, owner, nameWithOwner }) => {
      expect(parseGitHubRepoFromRemoteUrl(url)).toEqual({ owner, nameWithOwner });
    }
  );

  it('returns null for non-GitHub URL', () => {
    expect(parseGitHubRepoFromRemoteUrl('https://example.com/foo')).toBeNull();
  });
});

const execCalls: string[] = [];
const createPrHandlerState = {
  current: null as ((_e: unknown, args: unknown) => Promise<unknown>) | null,
};

type CreatePrMockState = {
  repoViewJson: string | null;
  repoViewReject: boolean;
  prCreateReject: boolean;
  prCreateRejectMessage: string | null;
  pushReject: boolean;
  revListStdout: string;
};
const createPrMockState: CreatePrMockState = {
  repoViewJson: null,
  repoViewReject: false,
  prCreateReject: false,
  prCreateRejectMessage: null,
  pushReject: false,
  revListStdout: '1',
};

const defaultExecResponses: Record<string, string> = {
  'git status': '',
  'git push': '',
  'git remote get-url origin': 'https://github.com/mrsh/emdash.git',
  'gh repo view --json nameWithOwner,isFork,parent': JSON.stringify({
    nameWithOwner: 'mrsh/emdash',
    isFork: true,
    parent: { nameWithOwner: 'generalaction/emdash' },
  }),
  'git branch --show-current': 'feat/my-branch',
  'git rev-parse --abbrev-ref HEAD': 'feat/my-branch',
  'gh repo view --json defaultBranchRef': 'main',
  'git remote show origin': '',
  'git rev-list': '1',
};

const CREATE_PR_SUCCESS_EXEC_PATTERNS = [
  'git status',
  'git push',
  'git remote get-url origin',
  'gh repo view --json nameWithOwner,isFork,parent',
  'git branch --show-current',
  'gh repo view --json defaultBranchRef',
  'git rev-list',
  'gh pr create',
] as const;

function execResponse(command: string): string {
  if (command.includes('gh repo view --json nameWithOwner,isFork,parent')) {
    if (createPrMockState.repoViewReject) throw new Error('gh repo view failed');
    if (createPrMockState.repoViewJson !== null) return createPrMockState.repoViewJson;
  }
  if (command.includes('git rev-list')) return createPrMockState.revListStdout;
  for (const [key, value] of Object.entries(defaultExecResponses)) {
    if (command.includes(key)) return value;
  }
  throw new Error(`Unmocked exec command: ${command}`);
}

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args: unknown) => Promise<unknown>) => {
      if (channel === 'git:create-pr') createPrHandlerState.current = handler;
    },
  },
}));

vi.mock('child_process', () => {
  const headRefError = Object.assign(
    new Error("GraphQL: Head sha can't be blank, No commits between main and feat/my-branch"),
    { stdout: '', stderr: 'pull request create failed' }
  );
  const execImpl = (
    command: string,
    options: unknown,
    callback?: (err: Error | null, stdout: string, stderr: string) => void
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void;
    execCalls.push(command);
    if (command.includes('git push') && createPrMockState.pushReject) {
      setImmediate(() => cb(new Error('push failed'), '', ''));
      return { kill: vi.fn() };
    }
    if (command.startsWith('gh pr create')) {
      if (createPrMockState.prCreateReject) {
        const msg = createPrMockState.prCreateRejectMessage ?? headRefError.message;
        const err = Object.assign(new Error(msg), { stdout: '', stderr: msg });
        setImmediate(() => cb(err, '', ''));
      } else {
        setImmediate(() => cb(null, 'https://github.com/generalaction/emdash/pull/123', ''));
      }
      return { kill: vi.fn() };
    }
    try {
      const stdout = execResponse(command);
      setImmediate(() => cb(null, stdout, ''));
    } catch (e) {
      setImmediate(() => cb(e as Error, '', ''));
    }
    return { kill: vi.fn() };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (execImpl as any)[promisify.custom] = (command: string) => {
    execCalls.push(command);
    if (command.includes('git push') && createPrMockState.pushReject) {
      return Promise.reject(new Error('push failed'));
    }
    if (command.startsWith('gh pr create')) {
      if (createPrMockState.prCreateReject) {
        const msg = createPrMockState.prCreateRejectMessage ?? headRefError.message;
        return Promise.reject(Object.assign(new Error(msg), { stdout: '', stderr: msg }));
      }
      return Promise.resolve({
        stdout: 'https://github.com/generalaction/emdash/pull/123',
        stderr: '',
      });
    }
    try {
      const stdout = execResponse(command);
      return Promise.resolve({ stdout, stderr: '' });
    } catch (e) {
      return Promise.reject(e);
    }
  };
  return { exec: execImpl, execFile: vi.fn() };
});

vi.mock('../../main/lib/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function getCreatePrHandler() {
  return createPrHandlerState.current as ((_e: unknown, args: unknown) => Promise<unknown>) | null;
}

function resetCreatePrMockState() {
  createPrMockState.repoViewJson = null;
  createPrMockState.repoViewReject = false;
  createPrMockState.prCreateReject = false;
  createPrMockState.prCreateRejectMessage = null;
  createPrMockState.pushReject = false;
  createPrMockState.revListStdout = '1';
}

describe('git:create-pr handler', () => {
  beforeEach(() => {
    execCalls.length = 0;
    createPrHandlerState.current = null;
    resetCreatePrMockState();
    registerGitIpc();
  });

  describe('success paths', () => {
    it('builds --head from origin owner and --repo from parent when fork', async () => {
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; url?: string; error?: string; code?: string };

      let lastIndex = -1;
      for (const pattern of CREATE_PR_SUCCESS_EXEC_PATTERNS) {
        const i = execCalls.findIndex((c) => c.includes(pattern));
        expect(i).toBeGreaterThan(lastIndex);
        lastIndex = i;
      }

      const prCreateCall = execCalls.find((c) => c.startsWith('gh pr create'));
      expect(prCreateCall).toBeDefined();
      expect(prCreateCall).toContain('--head "mrsh:feat/my-branch"');
      expect(prCreateCall).toContain('--repo "generalaction/emdash"');
      expect(result.success).toBe(true);
    });

    it('uses --repo from nameWithOwner and --head from origin when non-fork', async () => {
      createPrMockState.repoViewJson = JSON.stringify({
        nameWithOwner: 'mrsh/emdash',
        isFork: false,
        parent: null,
      });
      execCalls.length = 0;
      createPrHandlerState.current = null;
      registerGitIpc();
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; url?: string };

      const prCreateCall = execCalls.find((c) => c.startsWith('gh pr create'));
      expect(prCreateCall).toContain('--repo "mrsh/emdash"');
      expect(prCreateCall).toContain('--head "mrsh:feat/my-branch"');
      expect(result.success).toBe(true);
    });

    it('falls back to origin URL for repo when gh repo view fails', async () => {
      createPrMockState.repoViewReject = true;
      execCalls.length = 0;
      createPrHandlerState.current = null;
      registerGitIpc();
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; url?: string };

      const prCreateCall = execCalls.find((c) => c.startsWith('gh pr create'));
      expect(prCreateCall).toContain('--repo "mrsh/emdash"');
      expect(prCreateCall).toContain('--head "mrsh:feat/my-branch"');
      expect(result.success).toBe(true);
    });

    it('uses explicit --head when head arg is provided', async () => {
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
        head: 'custom-owner:custom-branch',
      });

      const prCreateCall = execCalls.find((c) => c.startsWith('gh pr create'));
      expect(prCreateCall).toContain('--head "custom-owner:custom-branch"');
    });
  });

  describe('error paths', () => {
    it('returns HEAD_REF_INVALID when gh pr create fails with head ref error', async () => {
      createPrMockState.prCreateReject = true;
      createPrMockState.prCreateRejectMessage =
        "GraphQL: Head sha can't be blank, No commits between main and feat/my-branch";
      execCalls.length = 0;
      createPrHandlerState.current = null;
      registerGitIpc();
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; error?: string; code?: string };

      expect(result.success).toBe(false);
      expect(result.code).toBe('HEAD_REF_INVALID');
      expect(result.error).toContain('Ensure the branch was pushed to origin');
    });

    it('returns PR_ALREADY_EXISTS when gh pr create reports existing PR', async () => {
      createPrMockState.prCreateReject = true;
      createPrMockState.prCreateRejectMessage =
        'pull request already exists for branch feat/my-branch';
      execCalls.length = 0;
      createPrHandlerState.current = null;
      registerGitIpc();
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; error?: string; code?: string };

      expect(result.success).toBe(false);
      expect(result.code).toBe('PR_ALREADY_EXISTS');
    });

    it('returns ORG_AUTH_APP_RESTRICTED when gh pr create reports org restrictions', async () => {
      createPrMockState.prCreateReject = true;
      createPrMockState.prCreateRejectMessage =
        'Auth App access restrictions prevent third-parties from creating PRs';
      execCalls.length = 0;
      createPrHandlerState.current = null;
      registerGitIpc();
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; error?: string; code?: string };

      expect(result.success).toBe(false);
      expect(result.code).toBe('ORG_AUTH_APP_RESTRICTED');
    });

    it('returns failure when git push fails', async () => {
      createPrMockState.pushReject = true;
      execCalls.length = 0;
      createPrHandlerState.current = null;
      registerGitIpc();
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toContain('push');
    });

    it('returns failure when no commits ahead of base', async () => {
      createPrMockState.revListStdout = '0';
      execCalls.length = 0;
      createPrHandlerState.current = null;
      registerGitIpc();
      const handler = getCreatePrHandler();
      expect(handler).not.toBeNull();
      if (!handler) return;

      const result = (await handler(null, {
        taskPath: '/tmp/repo',
        title: 'Test PR',
      })) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no commits to create a pr/i);
    });
  });
});
