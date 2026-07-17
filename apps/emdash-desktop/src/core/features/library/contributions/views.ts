import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const libraryTabSchema = z.enum(['prompts', 'skills', 'mcp']);

export const libraryViewDef = defineView({
  id: 'library',
  params: z.object({
    tab: libraryTabSchema.optional(),
  }),
  layout: workbenchLayout,
  traits: ['library'],
  telemetryEvent: 'library_viewed',
});
