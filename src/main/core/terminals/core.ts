import { Terminal } from '@shared/terminal/types';
import { TerminalRow } from '@main/db/schema';

export function mapTerminalRowToTerminal(row: TerminalRow): Terminal {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    name: row.name,
  };
}
