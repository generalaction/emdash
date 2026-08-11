import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const homeViewDef = defineView({
  id: 'home',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'home_viewed',
});
