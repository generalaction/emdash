import { eq } from 'drizzle-orm';
import type { AgentEvent } from '@core/primitives/agents/api';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { getPluginMetadata } from '@main/core/agents/plugin-registry';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import type { NotificationService } from '../notification-service';
import { agentNotificationInputFromEvent, notificationMapping } from './agent-status-mapping';

export function installAgentStatusNotificationProducer(service: NotificationService): () => void {
  return agentStatusService.on('agent:event', (event) => {
    void publishAgentNotification(service, event);
  });
}

export async function publishAgentNotification(
  service: Pick<NotificationService, 'publish'>,
  event: AgentEvent
): Promise<string | null> {
  const mapping = notificationMapping(event);
  if (!mapping) return null;

  const providerName = event.providerId ? getProviderName(event.providerId) : 'Agent';
  const taskName = await getTaskName(event.taskId);
  return service.publish(agentNotificationInputFromEvent(event, providerName, taskName, mapping));
}

async function getTaskName(taskId: string | undefined): Promise<string | null> {
  if (!taskId) return null;
  const [row] = await db
    .select({ name: tasks.name })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.name ?? null;
}

function getProviderName(providerId: string): string {
  try {
    return getPluginMetadata(providerId).name;
  } catch {
    return providerId;
  }
}
