import { taskManager } from '../tasks/task-manager';
import { taskService } from '../tasks/task-service';
import { captureTaskCreatedTelemetry, captureTaskProvisionedTelemetry } from './task-telemetry';

taskService.on('task:created', captureTaskCreatedTelemetry);
taskManager.hooks.on('task:provisioned', ({ projectId, taskId }) => {
  captureTaskProvisionedTelemetry(projectId, taskId);
});
