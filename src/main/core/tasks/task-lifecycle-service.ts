import { createScriptTerminalId } from '@shared/terminals';
import type { TerminalProvider } from '../terminals/terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TaskLifecycleService {
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly terminals: TerminalProvider;

  constructor({
    projectId,
    taskId,
    terminals,
  }: {
    projectId: string;
    taskId: string;
    terminals: TerminalProvider;
  }) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.terminals = terminals;
  }

  async runLifecycleScript(
    script: {
      type: 'setup' | 'run' | 'teardown';
      script: string;
    },
    options: { shouldRespawn?: boolean; initialSize?: { cols: number; rows: number } } = {}
  ): Promise<void> {
    const { shouldRespawn = false, initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } } =
      options;

    const id = await createScriptTerminalId({
      projectId: this.projectId,
      taskId: this.taskId,
      type: script.type,
      script: script.script,
    });

    await this.terminals.spawnLifecycleScript({
      terminal: { id, projectId: this.projectId, taskId: this.taskId, name: script.type },
      command: script.script,
      initialSize,
      respawnOnExit: shouldRespawn,
      preserveBufferOnExit: !shouldRespawn,
      watchDevServer: script.type === 'run',
    });
  }
}
