import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EnvironmentProvider, IShellRunner, TaskEnvironment, ExecResult } from '../types';
import type { ProjectRow } from '../../db/schema';
import { LocalFileSystem } from '../../services/fs/LocalFileSystem';
import { LocalGitService } from '../../services/LocalGitService';

const execFileAsync = promisify(execFile);

class LocalShellRunner implements IShellRunner {
  async exec(command: string, cwd: string): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync('bash', ['-c', command], { cwd });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: (err.stdout ?? '').trim(),
        stderr: (err.stderr ?? '').trim(),
        exitCode: err.code ?? 1,
      };
    }
  }
}

export class LocalEnvironmentProvider implements EnvironmentProvider {
  readonly type = 'local';

  async provision(
    project: ProjectRow,
    task: { id: string; path: string }
  ): Promise<TaskEnvironment> {
    return {
      taskId: task.id,
      fs: new LocalFileSystem(task.path),
      git: new LocalGitService(),
      shell: new LocalShellRunner(),
      transport: 'local',
    };
  }

  async teardown(_taskId: string): Promise<void> {
    // Local resources are ephemeral — no explicit teardown needed.
  }
}

export const localEnvironmentProvider = new LocalEnvironmentProvider();
