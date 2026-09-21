import { describe, expect, it } from 'vitest';
import { previewServerUrl, type DirectPreviewServer } from './types';

describe('previewServerUrl', () => {
  it('brackets an IPv6 loopback host', () => {
    const server: DirectPreviewServer = {
      id: 'preview-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      urlPath: '/app',
      status: { kind: 'ready' },
      kind: 'direct',
      host: '::1',
      port: 5173,
    };

    expect(previewServerUrl(server)).toBe('http://[::1]:5173/app');
  });
});
