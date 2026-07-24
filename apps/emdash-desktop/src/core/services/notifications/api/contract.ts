import { ok } from '@emdash/shared/result';
import { defineContract, eventStream, liveModel, liveState, mutation } from '@emdash/wire/api';
import { z } from 'zod';
import {
  notificationDeliveryEventSchema,
  notificationListSchema,
  notificationTargetSchema,
  type NotificationList,
} from './schemas';

const notificationMutationErrorSchema = z.object({
  message: z.string(),
});

const idsInputSchema = z.object({
  ids: z.array(z.string()),
});

const markReadInputSchema = idsInputSchema.extend({
  at: z.number().int(),
});

const markAllReadInputSchema = z.object({
  at: z.number().int(),
});

export const notificationsContract = defineContract({
  feed: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: notificationListSchema }),
    },
    mutations: {
      markRead: mutation(
        { input: markReadInputSchema, data: z.void(), error: notificationMutationErrorSchema },
        (ctx, input) => {
          ctx.produce('list', (draft) => {
            const list = draft as NotificationList;
            for (const id of input.ids) {
              if (list[id]) list[id].readAt ??= input.at;
            }
          });
          return ok<void>();
        }
      ),
      markAllRead: mutation(
        { input: markAllReadInputSchema, data: z.void(), error: notificationMutationErrorSchema },
        (ctx, input) => {
          ctx.produce('list', (draft) => {
            for (const notification of Object.values(draft as NotificationList)) {
              notification.readAt ??= input.at;
            }
          });
          return ok<void>();
        }
      ),
      dismiss: mutation(
        { input: idsInputSchema, data: z.void(), error: notificationMutationErrorSchema },
        (ctx, input) => {
          ctx.produce('list', (draft) => {
            const list = draft as NotificationList;
            for (const id of input.ids) delete list[id];
          });
          return ok<void>();
        }
      ),
    },
  }),
  delivery: eventStream({
    key: z.void().optional(),
    event: notificationDeliveryEventSchema,
  }),
});

export type NotificationsContract = typeof notificationsContract;
export type NotificationMutationError = z.infer<typeof notificationMutationErrorSchema>;
export { notificationTargetSchema };
