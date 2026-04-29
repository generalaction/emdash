import { isObservableArray, isObservableObject } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modalStore } from './modal-store';

describe('modalStore', () => {
  afterEach(() => {
    modalStore.activeModalId = null;
    modalStore.activeModalArgs = null;
    modalStore.closeGuardActive = false;
  });

  it('keeps modal args as plain reference data for IPC payloads', () => {
    const server = {
      name: 'datadog',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@datadog/mcp-server'],
      env: { DATADOG_API_KEY: 'from-shell' },
      providers: ['claude'],
    };
    const args = {
      mode: { type: 'edit' as const, server },
      providers: [{ id: 'claude', name: 'Claude Code', installed: true, supportsHttp: true }],
      onSave: vi.fn(),
    };

    modalStore.setModal('mcpServerModal', args);

    expect(modalStore.activeModalArgs).toBe(args);
    expect(isObservableObject(modalStore.activeModalArgs?.mode)).toBe(false);
    expect(isObservableObject(server)).toBe(false);
    expect(isObservableArray(server.providers)).toBe(false);
    expect(() => structuredClone(server)).not.toThrow();
  });
});
