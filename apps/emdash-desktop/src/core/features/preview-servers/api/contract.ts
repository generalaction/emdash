import { defineContract, eventStream, fallible } from '@emdash/wire/rpc';
import { z } from 'zod';
import type {
  ManualPreviewServerError,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerUnavailableError,
} from '@core/primitives/preview-servers/api';

export const previewServersDomain = 'previewServers' as const;

export const previewServersContract = defineContract({
  listForWorkspace: fallible({
    input: z.object({ projectId: z.string(), workspaceId: z.string() }),
    data: z.array(z.custom<PreviewServer>()),
    error: z.custom<PreviewServerUnavailableError>(),
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
  restart: fallible({
    input: z.object({ id: z.string() }),
    data: z.void(),
    error: z.custom<PreviewServerUnavailableError>(),
  }),
  stop: fallible({
    input: z.object({ id: z.string() }),
    data: z.void(),
    error: z.custom<PreviewServerUnavailableError>(),
  }),
  events: eventStream({
    key: z.void(),
    event: z.custom<PreviewServerEvent>(),
  }),
});
