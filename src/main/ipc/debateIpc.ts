import { ipcMain, BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import {
  HeadlessAgentRunner,
  HeadlessAgentProgress,
  getWorktreeDiff,
  runJudge,
} from '../services/HeadlessAgentService';

export interface DebateConfig {
  worktreeA: {
    id: string;
    path: string;
  };
  worktreeB: {
    id: string;
    path: string;
  };
  prompt: string;
  baseBranch?: string;
}

export interface DebateProgress {
  phase: 'running' | 'judging' | 'complete' | 'error';
  agentA: {
    status: 'running' | 'complete' | 'error';
    currentTool?: string;
    elapsedMs: number;
    error?: string;
  };
  agentB: {
    status: 'running' | 'complete' | 'error';
    currentTool?: string;
    elapsedMs: number;
    error?: string;
  };
  judge?: {
    status: 'running' | 'complete' | 'error';
    elapsedMs: number;
  };
}

export interface DebateResult {
  success: boolean;
  winner?: 'A' | 'B';
  reasoning?: string;
  diffA?: string;
  diffB?: string;
  winnerWorktreePath?: string;
  loserWorktreePath?: string;
  error?: string;
}

// Track active debates for cancellation
const activeDebates = new Map<
  string,
  { runnerA: HeadlessAgentRunner; runnerB: HeadlessAgentRunner }
>();

function broadcastProgress(debateId: string, progress: DebateProgress) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('debate:progress', { debateId, progress });
    } catch {}
  });
}

function broadcastResult(debateId: string, result: DebateResult) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('debate:result', { debateId, result });
    } catch {}
  });
}

export function registerDebateIpc() {
  // Start a debate between two agents
  ipcMain.handle(
    'debate:start',
    async (
      _,
      args: { debateId: string; config: DebateConfig }
    ): Promise<{ success: boolean; error?: string }> => {
      const { debateId, config } = args;

      log.info('debate:start', {
        debateId,
        worktreeA: config.worktreeA.path,
        worktreeB: config.worktreeB.path,
      });

      const progress: DebateProgress = {
        phase: 'running',
        agentA: { status: 'running', elapsedMs: 0 },
        agentB: { status: 'running', elapsedMs: 0 },
      };

      try {
        const runnerA = new HeadlessAgentRunner(config.worktreeA.path, config.prompt);
        const runnerB = new HeadlessAgentRunner(config.worktreeB.path, config.prompt);

        activeDebates.set(debateId, { runnerA, runnerB });

        // Set up progress listeners
        runnerA.on('progress', (p: HeadlessAgentProgress) => {
          progress.agentA.elapsedMs = p.elapsedMs;
          if (p.type === 'tool_use') {
            progress.agentA.currentTool = p.toolName;
          } else if (p.type === 'complete') {
            progress.agentA.status = 'complete';
            progress.agentA.currentTool = undefined;
          } else if (p.type === 'error') {
            progress.agentA.status = 'error';
            progress.agentA.error = p.text;
          }
          broadcastProgress(debateId, progress);
        });

        runnerB.on('progress', (p: HeadlessAgentProgress) => {
          progress.agentB.elapsedMs = p.elapsedMs;
          if (p.type === 'tool_use') {
            progress.agentB.currentTool = p.toolName;
          } else if (p.type === 'complete') {
            progress.agentB.status = 'complete';
            progress.agentB.currentTool = undefined;
          } else if (p.type === 'error') {
            progress.agentB.status = 'error';
            progress.agentB.error = p.text;
          }
          broadcastProgress(debateId, progress);
        });

        // Broadcast initial state
        broadcastProgress(debateId, progress);

        // Run agents in background - don't await, return immediately so modal closes
        runDebateInBackground(debateId, config, progress, runnerA, runnerB);

        return { success: true };
      } catch (err: any) {
        log.error('debate:start:error', { debateId, error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  // Cancel an ongoing debate
  ipcMain.handle('debate:cancel', async (_, args: { debateId: string }) => {
    const { debateId } = args;
    const debate = activeDebates.get(debateId);

    if (debate) {
      log.info('debate:cancel', { debateId });
      debate.runnerA.kill();
      debate.runnerB.kill();
      activeDebates.delete(debateId);
      return { success: true };
    }

    return { success: false, error: 'No active debate found' };
  });
}

// Run the debate flow in the background
async function runDebateInBackground(
  debateId: string,
  config: DebateConfig,
  progress: DebateProgress,
  runnerA: HeadlessAgentRunner,
  runnerB: HeadlessAgentRunner
) {
  try {
    // Run both agents in parallel
    const [resultA, resultB] = await Promise.all([runnerA.start(), runnerB.start()]);

    // Update progress with final results
    progress.agentA.status = resultA.success ? 'complete' : 'error';
    progress.agentA.elapsedMs = resultA.elapsedMs;
    if (!resultA.success) progress.agentA.error = resultA.error;

    progress.agentB.status = resultB.success ? 'complete' : 'error';
    progress.agentB.elapsedMs = resultB.elapsedMs;
    if (!resultB.success) progress.agentB.error = resultB.error;

    broadcastProgress(debateId, progress);

    // Handle cases where one or both agents failed
    if (!resultA.success && !resultB.success) {
      const result: DebateResult = {
        success: false,
        error: 'Both agents failed to complete',
      };
      broadcastResult(debateId, result);
      activeDebates.delete(debateId);
      return;
    }

    // Get diffs from both worktrees
    const baseBranch = config.baseBranch || 'main';
    let diffA = '';
    let diffB = '';

    try {
      diffA = resultA.success ? await getWorktreeDiff(config.worktreeA.path, baseBranch) : '';
    } catch (err) {
      log.warn('debate:getDiffA:error', { error: err });
    }

    try {
      diffB = resultB.success ? await getWorktreeDiff(config.worktreeB.path, baseBranch) : '';
    } catch (err) {
      log.warn('debate:getDiffB:error', { error: err });
    }

    // If only one agent succeeded, that's the winner
    if (!resultA.success || !diffA) {
      const result: DebateResult = {
        success: true,
        winner: 'B',
        reasoning: 'Agent A failed or produced no changes, defaulting to Agent B',
        diffA,
        diffB,
        winnerWorktreePath: config.worktreeB.path,
        loserWorktreePath: config.worktreeA.path,
      };
      broadcastResult(debateId, result);
      activeDebates.delete(debateId);
      return;
    }

    if (!resultB.success || !diffB) {
      const result: DebateResult = {
        success: true,
        winner: 'A',
        reasoning: 'Agent B failed or produced no changes, defaulting to Agent A',
        diffA,
        diffB,
        winnerWorktreePath: config.worktreeA.path,
        loserWorktreePath: config.worktreeB.path,
      };
      broadcastResult(debateId, result);
      activeDebates.delete(debateId);
      return;
    }

    // Both succeeded - run the judge
    progress.phase = 'judging';
    progress.judge = { status: 'running', elapsedMs: 0 };
    broadcastProgress(debateId, progress);

    const judgeResult = await runJudge(config.prompt, diffA, diffB, (p) => {
      if (progress.judge) {
        progress.judge.elapsedMs = p.elapsedMs;
        if (p.type === 'complete') {
          progress.judge.status = 'complete';
        }
        broadcastProgress(debateId, progress);
      }
    });

    progress.phase = 'complete';
    if (progress.judge) progress.judge.status = 'complete';
    broadcastProgress(debateId, progress);

    const result: DebateResult = {
      success: judgeResult.success,
      winner: judgeResult.winner,
      reasoning: judgeResult.reasoning,
      diffA,
      diffB,
      winnerWorktreePath:
        judgeResult.winner === 'A' ? config.worktreeA.path : config.worktreeB.path,
      loserWorktreePath: judgeResult.winner === 'A' ? config.worktreeB.path : config.worktreeA.path,
      error: judgeResult.error,
    };

    broadcastResult(debateId, result);
    activeDebates.delete(debateId);

    log.info('debate:complete', {
      debateId,
      winner: result.winner,
      reasoning: result.reasoning?.slice(0, 100),
    });
  } catch (err: any) {
    log.error('debate:error', { debateId, error: err.message });

    progress.phase = 'error';
    broadcastProgress(debateId, progress);

    const result: DebateResult = {
      success: false,
      error: err.message || 'Unknown error during debate',
    };
    broadcastResult(debateId, result);
    activeDebates.delete(debateId);
  }
}
