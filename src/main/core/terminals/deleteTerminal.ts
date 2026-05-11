import { and, eq } from 'drizzle-orm';
import { terminalDeletedChannel } from '@shared/events/terminalEvents';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { events } from '@main/lib/events';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';

export async function deleteTerminal({
  projectId,
  taskId,
  terminalId,
}: {
  projectId: string;
  taskId: string;
  terminalId: string;
}) {
  await db
    .delete(terminals)
    .where(
      and(
        eq(terminals.id, terminalId),
        eq(terminals.projectId, projectId),
        eq(terminals.taskId, taskId)
      )
    );

  const task = resolveTask(projectId, taskId);
  await task?.terminals.killTerminal(terminalId);
  events.emit(terminalDeletedChannel, { terminalId, taskId, projectId });
  telemetryService.capture('terminal_deleted', {
    terminal_id: terminalId,
    project_id: projectId,
    task_id: taskId,
  });
}
