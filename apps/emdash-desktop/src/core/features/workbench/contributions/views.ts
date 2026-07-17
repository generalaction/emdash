import { z } from 'zod';
import { defineView } from '@core/primitives/views/api';
import { workbenchLayout } from './layouts';

export const homeViewDef = defineView({
  id: 'home',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'home_viewed',
});
