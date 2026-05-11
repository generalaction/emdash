import {
  taskCreatedChannel,
  taskDeletedChannel,
  taskUpdatedChannel,
} from '@shared/events/taskEvents';
import { events } from '@main/lib/events';
import { taskEvents } from './task-events';

class TaskRendererEvents {
  private disposers: Array<() => void> = [];

  initialize(): void {
    if (this.disposers.length > 0) return;

    this.disposers = [
      taskEvents.on('task:created', (task) => events.emit(taskCreatedChannel, task)),
      taskEvents.on('task:updated', (task) => events.emit(taskUpdatedChannel, task)),
      taskEvents.on('task:deleted', (taskId, projectId) =>
        events.emit(taskDeletedChannel, { taskId, projectId })
      ),
    ];
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }
}

export const taskRendererEvents = new TaskRendererEvents();
