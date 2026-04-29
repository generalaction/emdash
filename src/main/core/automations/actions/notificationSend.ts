import { Notification } from 'electron';
import type { NotificationSendAction } from '@shared/automations/actions';
import { err, ok } from '@shared/result';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { applyTemplate } from './template';
import type { ActionExecutor } from './types';

export const executeNotificationSend: ActionExecutor<NotificationSendAction> = async (
  action,
  ctx
) => {
  const title = applyTemplate(action.title, ctx.event).trim() || ctx.automation.name;
  const body = applyTemplate(action.body, ctx.event).trim();

  const { enabled, osNotifications } = await appSettingsService.get('notifications');
  if (!enabled || !osNotifications) {
    return ok({ message: 'notifications_disabled' });
  }
  if (!Notification.isSupported()) {
    log.warn('automations.notification: OS notifications not supported, skipping', {
      automationId: ctx.automation.id,
    });
    return ok({ message: 'os_notifications_unsupported' });
  }

  try {
    new Notification({ title, body, silent: false }).show();
    return ok({ message: 'notification_sent' });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
};
