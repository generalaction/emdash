import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stripAnsi } from '@shared/text/stripAnsi';
import { log } from '../../lib/logger';
import type { ParsedFailedLog } from './types';

const execFileAsync = promisify(execFile);

interface GitHubRunStep {
  name?: string;
  conclusion?: string;
}

interface GitHubRunJob {
  name?: string;
  steps?: GitHubRunStep[];
}

interface GitHubRunView {
  workflowName?: string;
  jobs?: GitHubRunJob[];
}

function collectFailedStepNames(run: GitHubRunView): string[] {
  const failedSteps: string[] = [];

  for (const job of run.jobs || []) {
    for (const step of job.steps || []) {
      const conclusion = (step.conclusion || '').toLowerCase();
      if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'cancelled') {
        if (step.name) {
          failedSteps.push(step.name);
        }
      }
    }
  }

  return [...new Set(failedSteps)];
}

function extractLinesForFailedSteps(rawLog: string, failedStepNames: string[]): string {
  if (failedStepNames.length === 0) {
    return rawLog;
  }

  const failedStepSet = new Set(failedStepNames.map((step) => step.toLowerCase()));
  const lines = rawLog.split('\n');
  const selected: string[] = [];

  for (const line of lines) {
    const parts = line.split('\t');
    const stepName = parts.length > 1 ? parts[1]?.trim() : '';
    if (stepName && failedStepSet.has(stepName.toLowerCase())) {
      selected.push(line);
    }
  }

  return selected.length > 0 ? selected.join('\n') : rawLog;
}

function truncateFromBottom(
  text: string,
  maxChars: number
): { output: string; wasTruncated: boolean } {
  if (text.length <= maxChars) {
    return { output: text, wasTruncated: false };
  }

  const keepTail = text.slice(-maxChars);
  return {
    output: `[Output Truncated]\n${keepTail}`,
    wasTruncated: true,
  };
}

export function sanitizeAndTruncateLogOutput(
  rawLog: string,
  maxLogChars: number
): { output: string; wasTruncated: boolean } {
  const sanitizedLog = stripAnsi(rawLog || '', {
    stripOscSt: true,
    stripOtherEscapes: true,
  }).trim();

  return truncateFromBottom(sanitizedLog, maxLogChars);
}

export async function fetchAndParseFailedLog(
  taskPath: string,
  runId: number,
  maxLogChars: number
): Promise<ParsedFailedLog> {
  let workflowName = 'GitHub Actions';
  let failedStepNames: string[] = [];

  try {
    const { stdout: viewStdout } = await execFileAsync(
      'gh',
      ['run', 'view', String(runId), '--json', 'workflowName,jobs'],
      {
        cwd: taskPath,
        maxBuffer: 4 * 1024 * 1024,
      }
    );

    const runDetails = JSON.parse(viewStdout || '{}') as GitHubRunView;
    if (runDetails.workflowName) {
      workflowName = runDetails.workflowName;
    }
    failedStepNames = collectFailedStepNames(runDetails);
  } catch (error) {
    log.debug('fetchAndParseFailedLog: failed to fetch run details', {
      runId,
      taskPath,
      error: String(error),
    });
  }

  let rawFailedLog = '';
  try {
    const { stdout } = await execFileAsync('gh', ['run', 'view', String(runId), '--log-failed'], {
      cwd: taskPath,
      maxBuffer: 20 * 1024 * 1024,
    });
    rawFailedLog = stdout || '';
  } catch (error) {
    log.warn('fetchAndParseFailedLog: failed to fetch failed log output', {
      runId,
      taskPath,
      error: String(error),
    });
  }

  const stepScopedLog = extractLinesForFailedSteps(rawFailedLog, failedStepNames);
  const truncated = sanitizeAndTruncateLogOutput(stepScopedLog || rawFailedLog || '', maxLogChars);

  return {
    workflowName,
    failedStepNames,
    output: truncated.output,
    wasTruncated: truncated.wasTruncated,
  };
}
