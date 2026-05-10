import { type Terminal } from '@shared/terminals';
import { type TerminalRow } from '@main/db/schema';

export function mapTerminalRowToTerminal(row: TerminalRow): Terminal {
  return {
    id: row.id,
    taskId: row.taskId,
    ssh: row.ssh === 1,
    projectId: row.projectId,
    name: row.name,
  };
}
