import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const skillsViewDef = defineView({
  id: 'skills',
  params: z.object({}),
  layout: workbenchLayout,
  traits: ['library'],
  telemetryEvent: 'skills_viewed',
});
