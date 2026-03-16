import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { CiAutoFixConfig, CiFailureCandidate } from '../../../main/services/ci/types';

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const execFileMock = vi.fn();
const spawnMock = vi.fn();

const evaluateTriggerMock = vi.fn();
const markTriggeredMock = vi.fn();
const markAgentCommitMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('electron', () => ({
  Notification: class {
    readonly options: unknown;
    static isSupported() {
      return true;
    }
    constructor(options: unknown) {
      this.options = options;
    }
    show() {
      return true;
    }
  },
}));

vi.mock('../../../main/settings', () => ({
  getAppSettings: vi.fn(() => ({
    notifications: { enabled: false, osNotifications: false },
    defaultProvider: 'claude',
  })),
}));

vi.mock('../../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../main/services/DatabaseService', () => ({
  databaseService: {
    getTaskById: vi.fn(async () => ({ id: 'task-1', agentId: 'claude' })),
  },
}));

vi.mock('../../../main/services/ci/logParser', () => ({
  fetchAndParseFailedLog: vi.fn(async () => ({
    workflowName: 'CI',
    failedStepNames: ['Run tests'],
    output: 'failure output',
    wasTruncated: false,
  })),
}));

vi.mock('../../../main/services/ci/stateTracker', () => ({
  ciRetryStateTracker: {
    evaluateTrigger: (...args: unknown[]) => evaluateTriggerMock(...args),
    markTriggered: (...args: unknown[]) => markTriggeredMock(...args),
    markAgentCommit: (...args: unknown[]) => markAgentCommitMock(...args),
  },
  CiRetryStateTracker: class {
    static buildBranchKey(projectId: string, branchName: string) {
      return `${projectId}::${branchName}`;
    }
  },
}));

describe('CiFailureOrchestratorService race condition checks', () => {
  let taskPath = '';

  beforeEach(() => {
    vi.clearAllMocks();
    taskPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-ci-orchestrator-'));
    evaluateTriggerMock.mockReturnValue({
      allowed: true,
      state: { retryCount: 0, halted: false },
    });

    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: ExecFileCallback) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          callback(null, 'local-sha\n', '');
          return;
        }

        if (args[0] === 'ls-remote' && args[1] === '--heads') {
          callback(null, 'remote-sha\trefs/heads/emdash/task-123\n', '');
          return;
        }

        if (args[0] === 'status' && args[1] === '--porcelain') {
          callback(null, '', '');
          return;
        }

        callback(null, '', '');
      }
    );
  });

  afterEach(() => {
    fs.rmSync(taskPath, { recursive: true, force: true });
  });

  it('aborts before agent execution when local HEAD differs from remote HEAD', async () => {
    const { CiFailureOrchestratorService } = await import('../../../main/services/ci/orchestrator');

    const service = new CiFailureOrchestratorService();

    const candidate: CiFailureCandidate = {
      projectId: 'project-1',
      projectPath: '/tmp/project-1',
      taskId: 'task-1',
      taskPath,
      branchName: 'emdash/task-123',
      run: {
        runId: 3001,
        headSha: 'remote-sha',
        workflowName: 'CI',
        displayTitle: 'Run tests',
      },
    };

    const config: CiAutoFixConfig = {
      enabled: true,
      mode: 'auto',
      maxRetries: 2,
      triggerFilters: {
        include: ['*test*'],
        exclude: [],
      },
      maxLogChars: 4000,
      pollIntervalMs: 120000,
      providerId: 'claude',
    };

    const handleFailureCandidate = (
      service as unknown as {
        handleFailureCandidate: (
          nextCandidate: CiFailureCandidate,
          nextConfig: CiAutoFixConfig
        ) => Promise<void>;
      }
    ).handleFailureCandidate.bind(service);

    await handleFailureCandidate(candidate, config);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(markTriggeredMock).not.toHaveBeenCalled();

    const gitCalls = execFileMock.mock.calls
      .filter((call) => call[0] === 'git')
      .map((call) => call[1] as string[]);

    expect(gitCalls.some((args) => args[0] === 'add')).toBe(false);
    expect(gitCalls.some((args) => args[0] === 'commit')).toBe(false);
    expect(gitCalls.some((args) => args[0] === 'push')).toBe(false);
  });
});
