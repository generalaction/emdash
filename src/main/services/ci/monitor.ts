import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { minimatch } from 'minimatch';
import { databaseService } from '../DatabaseService';
import { log } from '../../lib/logger';
import { getGlobalCiAutoFixConfig, resolveCiAutoFixConfig } from './config';
import type { CiAutoFixConfig, CiFailureCandidate, CiFailedRunInfo } from './types';

const execFileAsync = promisify(execFile);

interface GitHubRunListItem {
  databaseId?: number;
  status?: string;
  conclusion?: string;
  headSha?: string;
  workflowName?: string;
  displayTitle?: string;
  event?: string;
  url?: string;
}

function parsePattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed.startsWith('/') || !trimmed.endsWith('/') || trimmed.length < 2) {
    return null;
  }
  const body = trimmed.slice(1, -1);
  try {
    return new RegExp(body, 'i');
  } catch {
    return null;
  }
}

function matchesPattern(value: string, pattern: string): boolean {
  const regex = parsePattern(pattern);
  if (regex) {
    return regex.test(value);
  }

  return minimatch(value, pattern, { nocase: true, matchBase: true });
}

function passesTriggerFilters(config: CiAutoFixConfig, checkName: string): boolean {
  const includeFilters = config.triggerFilters.include;
  const excludeFilters = config.triggerFilters.exclude;

  const included =
    includeFilters.length === 0 ||
    includeFilters.some((pattern) => matchesPattern(checkName, pattern));
  if (!included) {
    return false;
  }

  const excluded = excludeFilters.some((pattern) => matchesPattern(checkName, pattern));
  return !excluded;
}

function normalizeRun(item: GitHubRunListItem): CiFailedRunInfo | null {
  if (!item?.databaseId || !item?.headSha) {
    return null;
  }

  return {
    runId: item.databaseId,
    headSha: item.headSha,
    workflowName: item.workflowName || 'GitHub Actions',
    displayTitle: item.displayTitle || item.workflowName || 'Failed workflow',
    htmlUrl: item.url,
    event: item.event,
  };
}

async function getLatestFailedRun(
  taskPath: string,
  branchName: string
): Promise<CiFailedRunInfo | null> {
  const args = [
    'run',
    'list',
    '--branch',
    branchName,
    '--limit',
    '10',
    '--json',
    'databaseId,status,conclusion,headSha,workflowName,displayTitle,event,url',
  ];

  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd: taskPath,
      maxBuffer: 4 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout || '[]') as GitHubRunListItem[];
    const failed = parsed.find(
      (item) => item?.status === 'completed' && item?.conclusion === 'failure'
    );
    return failed ? normalizeRun(failed) : null;
  } catch (error) {
    log.debug('CiFailureMonitorService: failed to list workflow runs', {
      taskPath,
      branchName,
      error: String(error),
    });
    return null;
  }
}

export class CiFailureMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;

  private async processTask(
    task: Awaited<ReturnType<typeof databaseService.getTasks>>[number],
    projectById: Map<string, Awaited<ReturnType<typeof databaseService.getProjects>>[number]>,
    onFailure: (candidate: CiFailureCandidate, config: CiAutoFixConfig) => Promise<void>
  ): Promise<void> {
    if (task.status !== 'active' && task.status !== 'running') {
      return;
    }

    const project = projectById.get(task.projectId);
    if (!project || project.isRemote) {
      return;
    }

    const taskPath = task.path;
    if (!taskPath || !fs.existsSync(taskPath)) {
      return;
    }

    const config = resolveCiAutoFixConfig(project.path);
    if (!config.enabled) {
      return;
    }

    const failedRun = await getLatestFailedRun(taskPath, task.branch);
    if (!failedRun) {
      return;
    }

    const checkName = `${failedRun.workflowName} ${failedRun.displayTitle}`.trim();
    if (!passesTriggerFilters(config, checkName)) {
      return;
    }

    await onFailure(
      {
        projectId: project.id,
        projectPath: project.path,
        taskId: task.id,
        taskPath,
        branchName: task.branch,
        run: failedRun,
      },
      config
    );
  }

  start(
    onFailure: (candidate: CiFailureCandidate, config: CiAutoFixConfig) => Promise<void>
  ): void {
    if (this.timer) {
      return;
    }

    const loop = async () => {
      if (this.isPolling) {
        return;
      }
      this.isPolling = true;

      try {
        const tasks = await databaseService.getTasks();
        const projects = await databaseService.getProjects();
        const projectById = new Map(projects.map((project) => [project.id, project]));

        for (const task of tasks) {
          await this.processTask(task, projectById, onFailure);
        }
      } catch (error) {
        log.warn('CiFailureMonitorService: polling cycle failed', { error: String(error) });
      } finally {
        this.isPolling = false;
      }
    };

    void loop();

    const baseInterval = getGlobalCiAutoFixConfig().pollIntervalMs;
    this.timer = setInterval(() => {
      void loop();
    }, baseInterval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const ciFailureMonitorService = new CiFailureMonitorService();
