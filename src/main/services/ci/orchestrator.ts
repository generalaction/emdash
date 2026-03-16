import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Notification } from 'electron';
import { getProvider, isValidProviderId, type ProviderId } from '@shared/providers/registry';
import { getAppSettings } from '../../settings';
import { log } from '../../lib/logger';
import { databaseService } from '../DatabaseService';
import { ciFailureMonitorService } from './monitor';
import { fetchAndParseFailedLog } from './logParser';
import { ciRetryStateTracker, CiRetryStateTracker } from './stateTracker';
import type { CiAutoFixConfig, CiFailureCandidate } from './types';

const execFileAsync = promisify(execFile);

interface WorktreeLockHandle {
  lockPath: string;
  token: string;
}

type AgentRunResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

const LOCK_FILE_NAME = 'ci-agent.lock';
const STALE_LOCK_MS = 30 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function safeBranchSegment(branchName: string): string {
  return branchName.replace(/[^a-zA-Z0-9._/-]/g, '_');
}

function splitArgs(input: string): string[] {
  return input
    .split(' ')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildCiPrompt(
  candidate: CiFailureCandidate,
  parsedLog: string,
  mode: 'auto' | 'review'
): string {
  const modeInstruction =
    mode === 'auto'
      ? 'Do not commit or push by yourself. Only modify files and explain what you changed.'
      : 'Do not commit or push. Only modify files in the working tree so a human can review.';

  return [
    'You are fixing a CI failure in this repository.',
    '',
    `Branch: ${candidate.branchName}`,
    `Workflow: ${candidate.run.workflowName}`,
    `Run ID: ${candidate.run.runId}`,
    '',
    'Primary objective:',
    '- Make the smallest safe code changes needed to fix the failing CI check.',
    '- Preserve existing project conventions and avoid unrelated edits.',
    `- ${modeInstruction}`,
    '',
    'Failed CI output context (already filtered and truncated):',
    parsedLog || '[No failed output was available from GitHub Actions logs.]',
  ].join('\n');
}

async function git(taskPath: string, args: string[], maxBuffer = 4 * 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: taskPath, maxBuffer });
  return (stdout || '').trim();
}

async function getLocalHeadSha(taskPath: string): Promise<string> {
  return git(taskPath, ['rev-parse', 'HEAD']);
}

async function getRemoteHeadSha(taskPath: string, branchName: string): Promise<string | null> {
  try {
    const output = await git(taskPath, ['ls-remote', '--heads', 'origin', branchName]);
    if (!output) {
      return null;
    }
    const [sha] = output.split(/\s+/);
    return sha || null;
  } catch {
    return null;
  }
}

async function getStatusSnapshot(taskPath: string): Promise<string> {
  return git(taskPath, ['status', '--porcelain', '--untracked-files=all']);
}

async function acquireWorktreeLock(taskPath: string): Promise<WorktreeLockHandle | null> {
  const lockDir = path.join(taskPath, '.emdash');
  const lockPath = path.join(lockDir, LOCK_FILE_NAME);
  const token = `${process.pid}-${Date.now()}`;

  await fs.promises.mkdir(lockDir, { recursive: true });

  const tryAcquire = async (): Promise<WorktreeLockHandle | null> => {
    try {
      const fileHandle = await fs.promises.open(lockPath, 'wx');
      const payload = {
        token,
        pid: process.pid,
        acquiredAt: nowIso(),
      };
      await fileHandle.writeFile(JSON.stringify(payload, null, 2), 'utf8');
      await fileHandle.close();
      return { lockPath, token };
    } catch (error: unknown) {
      const asNodeError = error as NodeJS.ErrnoException;
      if (asNodeError.code !== 'EEXIST') {
        throw error;
      }
      return null;
    }
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acquired = await tryAcquire();
    if (acquired) {
      return acquired;
    }

    try {
      const raw = await fs.promises.readFile(lockPath, 'utf8');
      const parsed = JSON.parse(raw) as { acquiredAt?: string };
      const acquiredMs = parsed?.acquiredAt ? Date.parse(parsed.acquiredAt) : Number.NaN;
      const stale = Number.isFinite(acquiredMs) && Date.now() - acquiredMs > STALE_LOCK_MS;
      if (stale) {
        await fs.promises.unlink(lockPath);
        continue;
      }
    } catch {
      await fs.promises.unlink(lockPath).catch(() => {});
      continue;
    }

    return null;
  }

  return null;
}

async function releaseWorktreeLock(handle: WorktreeLockHandle | null): Promise<void> {
  if (!handle) {
    return;
  }

  try {
    const raw = await fs.promises.readFile(handle.lockPath, 'utf8');
    const parsed = JSON.parse(raw) as { token?: string };
    if (parsed?.token !== handle.token) {
      return;
    }
  } catch {
    return;
  }

  await fs.promises.unlink(handle.lockPath).catch(() => {});
}

function maybeNotify(title: string, body: string): void {
  try {
    const settings = getAppSettings();
    if (!settings.notifications?.enabled || !settings.notifications?.osNotifications) {
      return;
    }
    if (!Notification.isSupported()) {
      return;
    }

    const notification = new Notification({ title, body, silent: true });
    notification.show();
  } catch {
    // best-effort notifications only
  }
}

async function runAgentForCiFix(
  providerId: ProviderId,
  taskPath: string,
  prompt: string,
  mode: 'auto' | 'review'
): Promise<AgentRunResult> {
  const provider = getProvider(providerId);
  if (!provider?.cli) {
    return { ok: false, error: `Provider ${providerId} has no CLI command configured` };
  }

  if (provider.useKeystrokeInjection || provider.initialPromptFlag === undefined) {
    return {
      ok: false,
      error: `Provider ${providerId} cannot receive non-interactive prompts safely for CI auto-fix`,
    };
  }

  const args: string[] = [];
  if (provider.defaultArgs?.length) {
    args.push(...provider.defaultArgs);
  }
  if (mode === 'auto' && provider.autoApproveFlag) {
    args.push(...splitArgs(provider.autoApproveFlag));
  }
  if (provider.initialPromptFlag) {
    args.push(provider.initialPromptFlag);
  }
  args.push(prompt);

  const cli = provider.cli;

  return new Promise<AgentRunResult>((resolve) => {
    const child = spawn(cli, args, {
      cwd: taskPath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // no-op
      }
      resolve({ ok: false, error: 'Agent run timed out after 15 minutes' });
    }, 15 * 60_000);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, error: error.message });
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (signal) {
        resolve({ ok: false, error: `Agent terminated by signal ${signal}` });
        return;
      }
      if (code !== 0) {
        const trimmedErr = stderr.trim();
        resolve({
          ok: false,
          error: trimmedErr || `Agent exited with status code ${String(code)}`,
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}

export class CiFailureOrchestratorService {
  private started = false;
  private readonly inFlightByBranch = new Set<string>();

  private async ensureAutoModeSafeStartingPoint(
    candidate: CiFailureCandidate,
    config: CiAutoFixConfig,
    localHeadSha: string
  ): Promise<{ ok: true; remoteHeadAtStart: string | null; statusBefore: string } | { ok: false }> {
    const remoteHeadAtStart = await getRemoteHeadSha(candidate.taskPath, candidate.branchName);
    if (remoteHeadAtStart && remoteHeadAtStart !== localHeadSha) {
      log.info('CiFailureOrchestrator: skipping due to local/remote head mismatch before start', {
        branch: candidate.branchName,
        localHeadSha,
        remoteHeadAtStart,
      });
      return { ok: false };
    }

    const statusBefore = await getStatusSnapshot(candidate.taskPath);
    if (config.mode === 'auto' && statusBefore.trim().length > 0) {
      maybeNotify(
        'CI Auto-Fix needs review',
        `Skipped auto-commit for ${safeBranchSegment(candidate.branchName)} because worktree was already dirty.`
      );
      return { ok: false };
    }

    return { ok: true, remoteHeadAtStart, statusBefore };
  }

  private async finalizeAutoMode(
    candidate: CiFailureCandidate,
    branchKey: string,
    localHeadSha: string,
    remoteHeadAtStart: string | null
  ): Promise<void> {
    const remoteHeadBeforePush = await getRemoteHeadSha(candidate.taskPath, candidate.branchName);
    if (remoteHeadAtStart && remoteHeadBeforePush && remoteHeadBeforePush !== remoteHeadAtStart) {
      maybeNotify(
        'CI Auto-Fix aborted',
        `Remote branch changed while agent was running for ${safeBranchSegment(candidate.branchName)}.`
      );
      return;
    }

    const localHeadBeforeCommit = await getLocalHeadSha(candidate.taskPath);
    if (localHeadBeforeCommit !== localHeadSha) {
      maybeNotify(
        'CI Auto-Fix aborted',
        `Local HEAD changed during run for ${safeBranchSegment(candidate.branchName)}. Review manually.`
      );
      return;
    }

    await execFileAsync('git', ['add', '-A'], { cwd: candidate.taskPath });

    const commitMessage = `fix(ci): auto-fix workflow failure (run ${candidate.run.runId})`;
    try {
      await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: candidate.taskPath });
    } catch (error) {
      const message = String(error);
      if (message.includes('nothing to commit')) {
        maybeNotify('CI Auto-Fix complete', `No committable changes for ${candidate.branchName}.`);
        return;
      }
      throw error;
    }

    const agentCommitSha = await getLocalHeadSha(candidate.taskPath);
    ciRetryStateTracker.markAgentCommit(
      branchKey,
      candidate.projectId,
      candidate.branchName,
      agentCommitSha
    );

    await execFileAsync('git', ['push', 'origin', `HEAD:${candidate.branchName}`], {
      cwd: candidate.taskPath,
    });

    maybeNotify(
      'CI Auto-Fix pushed',
      `Pushed an automated CI fix to ${safeBranchSegment(candidate.branchName)}.`
    );
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    ciFailureMonitorService.start(async (candidate, config) => {
      await this.handleFailureCandidate(candidate, config);
    });
  }

  stop(): void {
    this.started = false;
    ciFailureMonitorService.stop();
    this.inFlightByBranch.clear();
  }

  private async resolveProviderId(
    candidate: CiFailureCandidate,
    config: CiAutoFixConfig
  ): Promise<ProviderId> {
    if (config.providerId && isValidProviderId(config.providerId)) {
      return config.providerId;
    }

    const task = await databaseService.getTaskById(candidate.taskId);
    if (task?.agentId && isValidProviderId(task.agentId)) {
      return task.agentId;
    }

    const settings = getAppSettings();
    if (settings.defaultProvider && isValidProviderId(settings.defaultProvider)) {
      return settings.defaultProvider;
    }

    return 'claude';
  }

  private async handleFailureCandidate(
    candidate: CiFailureCandidate,
    config: CiAutoFixConfig
  ): Promise<void> {
    const branchKey = CiRetryStateTracker.buildBranchKey(candidate.projectId, candidate.branchName);
    if (this.inFlightByBranch.has(branchKey)) {
      return;
    }

    this.inFlightByBranch.add(branchKey);
    let lockHandle: WorktreeLockHandle | null = null;

    try {
      const localHeadSha = await getLocalHeadSha(candidate.taskPath);

      if (candidate.run.headSha && candidate.run.headSha !== localHeadSha) {
        log.info(
          'CiFailureOrchestrator: skipping because failed run head differs from local head',
          {
            branch: candidate.branchName,
            localHeadSha,
            runHeadSha: candidate.run.headSha,
          }
        );
        return;
      }

      const gate = ciRetryStateTracker.evaluateTrigger({
        branchKey,
        projectId: candidate.projectId,
        branchName: candidate.branchName,
        currentHeadSha: localHeadSha,
        runId: candidate.run.runId,
        maxRetries: config.maxRetries,
      });

      if (!gate.allowed) {
        if (gate.reason === 'max-retries-reached') {
          maybeNotify(
            'CI Auto-Fix halted',
            `Reached max retries for ${safeBranchSegment(candidate.branchName)}. Make a manual commit to reset.`
          );
        }
        return;
      }

      lockHandle = await acquireWorktreeLock(candidate.taskPath);
      if (!lockHandle) {
        log.info('CiFailureOrchestrator: worktree is already locked, skipping run', {
          taskPath: candidate.taskPath,
          branchName: candidate.branchName,
        });
        return;
      }

      const startingPoint = await this.ensureAutoModeSafeStartingPoint(
        candidate,
        config,
        localHeadSha
      );
      if (!startingPoint.ok) {
        return;
      }
      const { remoteHeadAtStart, statusBefore } = startingPoint;

      ciRetryStateTracker.markTriggered({
        branchKey,
        projectId: candidate.projectId,
        branchName: candidate.branchName,
        currentHeadSha: localHeadSha,
        runId: candidate.run.runId,
        maxRetries: config.maxRetries,
      });

      const parsedLog = await fetchAndParseFailedLog(
        candidate.taskPath,
        candidate.run.runId,
        config.maxLogChars
      );
      const prompt = buildCiPrompt(candidate, parsedLog.output, config.mode);
      const providerId = await this.resolveProviderId(candidate, config);
      const runResult = await runAgentForCiFix(providerId, candidate.taskPath, prompt, config.mode);

      if (!runResult.ok) {
        maybeNotify(
          'CI Auto-Fix failed',
          `Agent failed on ${safeBranchSegment(candidate.branchName)}: ${runResult.error}`
        );
        return;
      }

      const statusAfter = await getStatusSnapshot(candidate.taskPath);
      const changed = statusAfter.trim() !== statusBefore.trim();
      if (!changed) {
        maybeNotify(
          'CI Auto-Fix complete',
          `Agent did not produce file changes for ${candidate.branchName}.`
        );
        return;
      }

      if (config.mode === 'review') {
        maybeNotify(
          'CI fix ready for review',
          `Agent proposed changes in worktree ${safeBranchSegment(candidate.branchName)}. Please review.`
        );
        return;
      }

      await this.finalizeAutoMode(candidate, branchKey, localHeadSha, remoteHeadAtStart);
    } catch (error) {
      log.warn('CiFailureOrchestrator: failed to handle candidate', {
        branch: candidate.branchName,
        runId: candidate.run.runId,
        error: String(error),
      });
    } finally {
      await releaseWorktreeLock(lockHandle);
      this.inFlightByBranch.delete(branchKey);
    }
  }
}

export const ciFailureOrchestratorService = new CiFailureOrchestratorService();
