import z from 'zod';
import { definePluginCapability } from '../../../lib/plugins/capability';

export const sessionsCapability = definePluginCapability()(
  'sessions',
  z.object({
    kind: z.enum(['resumable', 'stateless']),
  })
);
