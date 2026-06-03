import { type TerminalRow } from '@main/db/schema';
import { type Terminal } from '@shared/terminals';

export function mapTerminalRowToTerminal(row: TerminalRow): Terminal {
  return {
    id: row.id,
    taskId: row.taskId,
    ssh: row.ssh === 1,
    projectId: row.projectId,
    shellId: row.shellId,
    name: row.name,
  };
}
