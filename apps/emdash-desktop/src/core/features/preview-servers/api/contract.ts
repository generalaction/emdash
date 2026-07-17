import { defineContract, eventStream, procedure } from '@emdash/wire';
import { z } from 'zod';
import type { PreviewServer, PreviewServerEvent } from '@core/primitives/preview-servers/api';

export const previewServersContract = defineContract({
  listForWorkspace: procedure({
    input: z.object({ projectId: z.string(), workspaceId: z.string() }),
    output: z.array(z.custom<PreviewServer>()),
  }),
  stop: procedure({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
  events: eventStream({
    key: z.void(),
    event: z.custom<PreviewServerEvent>(),
  }),
});
