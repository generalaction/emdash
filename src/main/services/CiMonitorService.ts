import { log } from '../lib/logger';
import { getAppSettings, type CiAutoFixSettings } from '../settings';
import { databaseService } from './DatabaseService';
import { getMainWindow } from '../app/window';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CICheckResult {
  checkName: string;
  workflowName: string;
  status: 'success' | 'failure' | 'pending' | 'skipped';
  runId?: string;
  conclusion?: string;
}

interface BranchStatus {
  branch: string;
  checks: CICheckResult[];
}

interface CiFailureContext {
  checkName: string;
  workflowName: string;
  conclusion?: string;
  runId?: string;
  logs?: string;
  triggeredAt: number;
}

class CiMonitorService {
  private interval: NodeJS.Timeout | null = null;
  private failureCounts = new Map<string, number>();
  private lastTriggerTime = new Map<string, number>();
  private isRunning = false;
  private failureCooldown = 5 * 60 * 1000;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    log.info('CiMonitorService: starting');
    await this.checkLoop();
  }

  stop(): void {
    this.isRunning = false;
    if (this.interval) {
      clearTimeout(this.interval);
      this.interval = null;
    }
    log.info('CiMonitorService: stopped');
  }

  private async checkLoop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.checkAllTaskBranches();
    } catch (err) {
      log.error('CiMonitorService: check failed', { error: (err as Error).message });
    }

    this.interval = setTimeout(() => this.checkLoop(), 30000);
  }

  private async checkAllTaskBranches(): Promise<void> {
    const settings = getAppSettings();
    const ciSettings = settings.ciAutoFix;

    if (!ciSettings?.enabled) return;

    const dbService = databaseService;
    const tasks = await dbService.getTasks();

    const activeTasks = tasks.filter((t) => t.status !== 'idle' && t.branch);

    const tasksByProject = new Map<string, typeof activeTasks>();
    for (const task of activeTasks) {
      const existing = tasksByProject.get(task.projectId) || [];
      existing.push(task);
      tasksByProject.set(task.projectId, existing);
    }

    for (const [projectId, projectTasks] of tasksByProject) {
      try {
        await this.checkProjectTasks(projectId, projectTasks, ciSettings);
      } catch (err) {
        log.error('CiMonitorService: check project failed', {
          projectId,
          error: (err as Error).message,
        });
      }
    }
  }

  private async checkProjectTasks(
    projectId: string,
    tasks: Array<{ branch: string; id: string; name: string; path: string }>,
    settings: CiAutoFixSettings
  ): Promise<void> {
    const project = await databaseService.getProjectById(projectId);
    if (!project?.githubInfo?.repository) return;

    const [owner, repo] = project.githubInfo.repository.split('/');

    for (const task of tasks) {
      const branchStatus = await this.getBranchStatus(owner, repo, task.branch, project.path);
      if (!branchStatus) continue;

      const failures = branchStatus.checks.filter((c) => c.status === 'failure');

      for (const failure of failures) {
        if (this.shouldSkipCheck(failure.checkName, settings)) continue;
        if (!this.shouldRetry(task.branch, settings.maxRetries)) continue;
        if (this.isCooldownActive(task.branch)) continue;

        await this.handleFailure(task, failure, settings);
      }

      const hasFailure = branchStatus.checks.some((c) => c.status === 'failure');
      if (!hasFailure) {
        this.failureCounts.delete(task.branch);
      }
    }
  }

  private async getBranchStatus(
    owner: string,
    repo: string,
    branch: string,
    cwd: string
  ): Promise<BranchStatus | null> {
    try {
      const checks: CICheckResult[] = [];

      try {
        const cmd = `gh run list --repo ${owner}/${repo} --branch ${branch} --json name,status,conclusion,runNumber --limit 10`;
        const { stdout } = await execAsync(cmd, { cwd });
        if (stdout) {
          const runs = JSON.parse(stdout);
          for (const run of runs) {
            checks.push({
              checkName: run.name,
              workflowName: run.name,
              status:
                run.conclusion === 'success'
                  ? 'success'
                  : run.conclusion === 'failure'
                    ? 'failure'
                    : run.status === 'completed'
                      ? 'skipped'
                      : 'pending',
              runId: String(run.runNumber),
              conclusion: run.conclusion,
            });
          }
        }
      } catch {
        log.debug('CiMonitorService: no runs found for branch', { branch });
      }

      return { branch, checks };
    } catch (err) {
      log.error('CiMonitorService: getBranchStatus failed', {
        branch,
        error: (err as Error).message,
      });
      return null;
    }
  }

  private shouldSkipCheck(checkName: string, settings: CiAutoFixSettings): boolean {
    const filters = settings.checkFilters;
    if (!filters) return false;

    const lowerName = checkName.toLowerCase();

    if (filters.exclude?.some((e) => lowerName.includes(e.toLowerCase()))) {
      return true;
    }

    if (
      filters.include?.length &&
      !filters.include.some((i) => lowerName.includes(i.toLowerCase()))
    ) {
      return true;
    }

    return false;
  }

  private shouldRetry(branch: string, maxRetries: number): boolean {
    const count = this.failureCounts.get(branch) || 0;
    return count < maxRetries;
  }

  private isCooldownActive(branch: string): boolean {
    const lastTrigger = this.lastTriggerTime.get(branch);
    if (!lastTrigger) return false;
    return Date.now() - lastTrigger < this.failureCooldown;
  }

  private async handleFailure(
    task: { id: string; name: string; path: string; branch: string },
    failure: CICheckResult,
    settings: CiAutoFixSettings
  ): Promise<void> {
    log.info('CiMonitorService: CI failure detected', {
      task: task.name,
      check: failure.checkName,
    });

    const count = this.failureCounts.get(task.branch) || 0;
    this.failureCounts.set(task.branch, count + 1);
    this.lastTriggerTime.set(task.branch, Date.now());

    let logs = '';
    if (failure.runId) {
      try {
        const logCmd = `gh run view ${failure.runId} --log-failed 2>/dev/null || echo "Logs not available"`;
        const logResult = await execAsync(logCmd, { cwd: task.path });
        logs = logResult.stdout || '';
      } catch {
        logs = 'Failed to fetch logs';
      }
    }

    const prompt = `CI Check Failed: ${failure.checkName}
Workflow: ${failure.workflowName}
Conclusion: ${failure.conclusion || 'unknown'}

${logs.slice(0, 8000)}

Please investigate and fix the issue. Analyze the failure, make necessary changes, and commit them.`;

    const failureContext: CiFailureContext = {
      checkName: failure.checkName,
      workflowName: failure.workflowName,
      conclusion: failure.conclusion,
      runId: failure.runId,
      logs: logs.slice(0, 8000),
      triggeredAt: Date.now(),
    };

    await this.storeFailureContext(task.id, failureContext, prompt, settings.mode);

    this.notifyRenderer(task.id, task.name, settings.mode);
  }

  private async storeFailureContext(
    taskId: string,
    context: CiFailureContext,
    prompt: string,
    mode: 'auto' | 'review'
  ): Promise<void> {
    try {
      const db = databaseService;
      const task = await db.getTaskById(taskId);
      if (!task) return;

      const metadata = task.metadata ? { ...task.metadata } : {};
      const pendingFixes: CiFailureContext[] = metadata.pendingCiFixes || [];
      const existingIndex = pendingFixes.findIndex((f) => f.checkName === context.checkName);

      if (existingIndex >= 0) {
        pendingFixes[existingIndex] = context;
      } else {
        pendingFixes.push(context);
      }

      metadata.pendingCiFixes = pendingFixes;
      metadata.ciAutoFixPrompt = prompt;
      metadata.ciAutoFixMode = mode;
      metadata.ciAutoFixTriggeredAt = context.triggeredAt;

      await db.saveTask({
        ...task,
        metadata,
      });

      log.info('CiMonitorService: stored failure context', { taskId, check: context.checkName });
    } catch (err) {
      log.error('CiMonitorService: failed to store failure context', {
        taskId,
        error: (err as Error).message,
      });
    }
  }

  private notifyRenderer(taskId: string, taskName: string, mode: 'auto' | 'review'): void {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    mainWindow.webContents.send('ci:pendingAutoFix', {
      taskId,
      taskName,
      mode,
    });

    log.info('CiMonitorService: notified renderer of pending auto-fix', { taskId, mode });
  }
}

export const ciMonitorService = new CiMonitorService();
