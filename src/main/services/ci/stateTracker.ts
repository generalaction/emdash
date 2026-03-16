import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { log } from '../../lib/logger';
import type { CiBranchRetryState, CiRetryStateFile } from './types';

interface TriggerGateInput {
  branchKey: string;
  projectId: string;
  branchName: string;
  currentHeadSha: string;
  runId: number;
  maxRetries: number;
}

interface TriggerGateResult {
  allowed: boolean;
  reason?: string;
  state: CiBranchRetryState;
}

const RETRY_STATE_FILE = 'ci_retries.json';

function nowIso(): string {
  return new Date().toISOString();
}

function defaultState(projectId: string, branchName: string): CiBranchRetryState {
  return {
    projectId,
    branchName,
    retryCount: 0,
    halted: false,
    lastObservedHeadSha: null,
    lastAgentCommitSha: null,
    lastHandledRunId: null,
    updatedAt: nowIso(),
  };
}

export class CiRetryStateTracker {
  private state: CiRetryStateFile = { version: 1, branches: {} };
  private loaded = false;
  private saveQueue: Promise<void> = Promise.resolve();

  private get statePath(): string {
    return path.join(app.getPath('userData'), RETRY_STATE_FILE);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const filePath = this.statePath;
      if (!fs.existsSync(filePath)) {
        return;
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as CiRetryStateFile;
      if (parsed?.version !== 1 || typeof parsed?.branches !== 'object' || !parsed.branches) {
        return;
      }

      this.state = parsed;
    } catch (error) {
      log.warn('CiRetryStateTracker: failed to read retry state, using defaults', {
        error: String(error),
      });
    }
  }

  private persist(): void {
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(async () => {
        const filePath = this.statePath;
        const directory = path.dirname(filePath);
        await fs.promises.mkdir(directory, { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(this.state, null, 2), 'utf8');
      })
      .catch((error) => {
        log.warn('CiRetryStateTracker: failed to persist retry state', {
          error: String(error),
        });
      });
  }

  private getOrCreate(
    branchKey: string,
    projectId: string,
    branchName: string
  ): CiBranchRetryState {
    this.ensureLoaded();
    const existing = this.state.branches[branchKey];
    if (existing) {
      return existing;
    }
    const created = defaultState(projectId, branchName);
    this.state.branches[branchKey] = created;
    this.persist();
    return created;
  }

  private resetForManualCommit(state: CiBranchRetryState, currentHeadSha: string): void {
    state.retryCount = 0;
    state.halted = false;
    state.lastHandledRunId = null;
    state.lastAgentCommitSha = null;
    state.lastObservedHeadSha = currentHeadSha;
    state.updatedAt = nowIso();
  }

  private syncHead(state: CiBranchRetryState, currentHeadSha: string): void {
    const previousHead = state.lastObservedHeadSha;
    if (!previousHead) {
      state.lastObservedHeadSha = currentHeadSha;
      state.updatedAt = nowIso();
      return;
    }

    if (previousHead === currentHeadSha) {
      return;
    }

    const changedByAgent =
      state.lastAgentCommitSha !== null && currentHeadSha === state.lastAgentCommitSha;
    if (!changedByAgent) {
      this.resetForManualCommit(state, currentHeadSha);
      return;
    }

    state.lastObservedHeadSha = currentHeadSha;
    state.updatedAt = nowIso();
  }

  evaluateTrigger(input: TriggerGateInput): TriggerGateResult {
    const state = this.getOrCreate(input.branchKey, input.projectId, input.branchName);
    this.syncHead(state, input.currentHeadSha);

    if (state.lastHandledRunId === input.runId) {
      return {
        allowed: false,
        reason: 'run-already-handled',
        state,
      };
    }

    if (state.halted || state.retryCount >= input.maxRetries) {
      state.halted = true;
      state.updatedAt = nowIso();
      this.persist();
      return {
        allowed: false,
        reason: 'max-retries-reached',
        state,
      };
    }

    return {
      allowed: true,
      state,
    };
  }

  markTriggered(input: TriggerGateInput): CiBranchRetryState {
    const state = this.getOrCreate(input.branchKey, input.projectId, input.branchName);
    this.syncHead(state, input.currentHeadSha);
    state.retryCount += 1;
    state.lastHandledRunId = input.runId;
    state.halted = state.retryCount >= input.maxRetries;
    state.lastObservedHeadSha = input.currentHeadSha;
    state.updatedAt = nowIso();
    this.persist();
    return state;
  }

  markAgentCommit(
    branchKey: string,
    projectId: string,
    branchName: string,
    commitSha: string
  ): void {
    const state = this.getOrCreate(branchKey, projectId, branchName);
    state.lastAgentCommitSha = commitSha;
    state.lastObservedHeadSha = commitSha;
    state.updatedAt = nowIso();
    this.persist();
  }

  static buildBranchKey(projectId: string, branchName: string): string {
    return `${projectId}::${branchName}`;
  }
}

export const ciRetryStateTracker = new CiRetryStateTracker();
