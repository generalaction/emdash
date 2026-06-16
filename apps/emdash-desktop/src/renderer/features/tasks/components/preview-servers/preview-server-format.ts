import type { PreviewServer } from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';

export function formatPreviewUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

export function formatPreviewServerLabel(server: PreviewServer): string {
  if (server.kind === 'forwarded') {
    return `${server.remotePort} -> ${server.localPort}`;
  }
  return formatPreviewUrl(previewServerUrl(server));
}

export function previewServerStatusLabel(server: PreviewServer): string {
  switch (server.status.kind) {
    case 'ready':
      return server.kind === 'forwarded' ? 'Forwarded' : 'Ready';
    case 'starting':
      return 'Starting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'failed':
      return 'Failed';
  }
}

export function previewServerStatusClasses(server: PreviewServer): string {
  switch (server.status.kind) {
    case 'ready':
      return 'bg-background-info text-foreground-info hover:bg-background-info-hover';
    case 'starting':
    case 'reconnecting':
      return 'bg-background-warning text-foreground-warning hover:bg-background-warning-hover';
    case 'failed':
      return 'bg-background-destructive text-foreground-destructive hover:bg-destructive/20';
  }
}
