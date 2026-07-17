import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const automationsViewDef = defineView({
  id: 'automations',
  params: z.object({
    automationId: z.string().optional(),
  }),
  layout: workbenchLayout,
  telemetryEvent: 'automations_viewed',
});
