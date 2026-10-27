import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const automationsViewTabSchema = z.enum(['automations', 'activity']);
export type AutomationsViewTab = z.infer<typeof automationsViewTabSchema>;

export const automationsViewDef = defineView({
  id: 'automations',
  params: z.object({
    automationId: z.string().optional(),
    tab: automationsViewTabSchema.optional(),
  }),
  layout: workbenchLayout,
  telemetryEvent: 'automations_viewed',
});

