import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const mcpViewDef = defineView({
  id: 'mcp',
  params: z.object({}),
  layout: workbenchLayout,
  traits: ['library'],
  telemetryEvent: 'mcp_viewed',
});
