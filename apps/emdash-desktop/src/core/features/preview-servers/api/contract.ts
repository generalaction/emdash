import { defineContract, eventStream, fallible, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  ManualPreviewServerError,
  PreviewServer,
  PreviewServerEvent,
} from '@core/primitives/preview-servers/api';

export const previewServersContract = defineContract({
  listForWorkspace: procedure({
    input: z.object({ projectId: z.string(), workspaceId: z.string() }),
    output: z.array(z.custom<PreviewServer>()),
  }),
  forwardManual: fallible({
    input: z.object({
      projectId: z.string(),
      workspaceId: z.string(),
      connectionId: z.string(),
      protocol: z.enum(['http:', 'https:']),
      remotePort: z.number().int().min(1).max(65535),
      preferredLocalPort: z.number().int().min(1).max(65535).optional(),
    }),
    data: z.custom<PreviewServer>(),
    error: z.custom<ManualPreviewServerError>(),
  }),
  restart: procedure({
    input: z.object({ id: z.string() }),
    output: z.void(),
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
