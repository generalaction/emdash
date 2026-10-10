import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const multitaskViewDef = defineView({
  id: 'multitask',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'multitask_viewed',
});
