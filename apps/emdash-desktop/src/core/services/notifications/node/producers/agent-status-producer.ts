import { eq } from 'drizzle-orm';
import type { AgentEvent } from '@core/primitives/agents/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { getPluginMetadata } from '@main/core/agents/plugin-registry';
import type { NotificationService } from '../notification-service';
import { agentNotificationInputFromEvent, notificationMapping } from './agent-status-mapping';

export function installAgentStatusNotificationProducer(
  service: NotificationService,
  deps: { db: AppDb }
): () => void {
  return agentStatusService.on('agent:event', (event) => {
    void publishAgentNotification(service, event, deps.db);
  });
}

export async function publishAgentNotification(
  service: Pick<NotificationService, 'publish'>,
  event: AgentEvent,
  db: AppDb
): Promise<string | null> {
  const mapping = notificationMapping(event);
  if (!mapping) return null;

  const providerName = event.providerId ? getProviderName(event.providerId) : 'Agent';
  const taskName = await getTaskName(db, event.taskId);
  return service.publish(agentNotificationInputFromEvent(event, providerName, taskName, mapping));
}

async function getTaskName(db: AppDb, taskId: string | undefined): Promise<string | null> {
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
