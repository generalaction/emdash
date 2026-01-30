import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from '../lib/logger';

export interface EmdashScripts {
  setup?: string;
  archive?: string;
}

export interface EmdashConfig {
  preservePatterns?: string[];
  scripts?: EmdashScripts;
}

export interface LifecycleEnv {
  EMDASH_TASK_NAME: string;
  EMDASH_TASK_ID: string;
  EMDASH_WORKTREE_PATH: string;
  EMDASH_PROJECT_PATH: string;
  EMDASH_BRANCH: string;
}

interface TaskInfo {
  id: string;
  name: string;
  branch?: string;
}

/**
 * Manages lifecycle scripts (setup/archive) for worktrees.
 * Scripts are configured in .emdash.json at the project root.
 */
class LifecycleScriptsService {
  /**
   * Read .emdash.json config from project root
   */
  readConfig(projectPath: string): EmdashConfig | null {
    try {
      const configPath = path.join(projectPath, '.emdash.json');
      if (!fs.existsSync(configPath)) {
        return null;
      }
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content) as EmdashConfig;
    } catch (error) {
      log.warn('Failed to read .emdash.json', { projectPath, error });
      return null;
    }
  }

  /**
   * Build environment variables for lifecycle scripts
   */
  buildEnv(task: TaskInfo, worktreePath: string, projectPath: string): LifecycleEnv {
    return {
      EMDASH_TASK_NAME: task.name,
      EMDASH_TASK_ID: task.id,
      EMDASH_WORKTREE_PATH: worktreePath,
      EMDASH_PROJECT_PATH: projectPath,
      EMDASH_BRANCH: task.branch || '',
    };
  }

  /**
   * Get the setup script command if configured
   */
  getSetupScript(projectPath: string): string | null {
    const config = this.readConfig(projectPath);
    return config?.scripts?.setup || null;
  }

  /**
   * Run the archive script in the background (fire and forget).
   * Called before worktree is removed.
   */
  runArchive(task: TaskInfo, worktreePath: string, projectPath: string): void {
    const config = this.readConfig(projectPath);
    const archiveScript = config?.scripts?.archive;

    if (!archiveScript) {
      return;
    }

    // Check if worktree path still exists
    if (!fs.existsSync(worktreePath)) {
      log.warn('Worktree path does not exist, skipping archive script', { worktreePath });
      return;
    }

    const env = {
      ...process.env,
      ...this.buildEnv(task, worktreePath, projectPath),
    };

    log.info('Running archive script', { taskId: task.id, script: archiveScript });

    try {
      // Fire and forget - detached process that won't block
      const child = spawn('sh', ['-c', archiveScript], {
        cwd: worktreePath,
        env,
        detached: true,
        stdio: 'ignore',
      });

      child.unref();
    } catch (error) {
      // Don't throw - archive script failure shouldn't block deletion
      log.error('Failed to start archive script', { taskId: task.id, error });
    }
  }
}

export const lifecycleScriptsService = new LifecycleScriptsService();
