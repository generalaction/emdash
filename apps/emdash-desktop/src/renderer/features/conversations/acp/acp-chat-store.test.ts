import { describe, expect, it, vi } from 'vitest';
import { bindSessionTerminalOutputs } from './acp-terminal-output-binding';
import { permissionModePresentation } from './permission-mode-presentation';

class FakeLiveList<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  current(): T {
    return this.value;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: T): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

class FakeLog {
  private listeners = new Set<() => void>();

  constructor(private value: string) {}

  text(): string {
    return this.value;
  }

  onAppend(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: string): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}

describe('bindSessionTerminalOutputs', () => {
  it('mirrors terminal log text and clears it on terminal removal', async () => {
    const terminals = new FakeLiveList([{ terminalId: 'term-1' }]);
    const log = new FakeLog('initial output');
    const terminalOutput = vi.fn(async () => log);
    const outputs = new Map<string, string | null>();

    const dispose = bindSessionTerminalOutputs({ terminals, terminalOutput }, (terminalId, text) =>
      outputs.set(terminalId, text)
    );
    await flushPromises();

    expect(terminalOutput).toHaveBeenCalledWith('term-1');
    expect(outputs.get('term-1')).toBe('initial output');

    log.set('live output');
    expect(outputs.get('term-1')).toBe('live output');

    terminals.set([]);
    expect(outputs.get('term-1')).toBeNull();

    log.set('late output');
    expect(outputs.get('term-1')).toBeNull();

    dispose();
  });

  it('clears mirrored outputs when disposed', async () => {
    const terminals = new FakeLiveList([{ terminalId: 'term-1' }]);
    const log = new FakeLog('initial output');
    const outputs = new Map<string, string | null>();

    const dispose = bindSessionTerminalOutputs(
      { terminals, terminalOutput: async () => log },
      (terminalId, text) => outputs.set(terminalId, text)
    );
    await flushPromises();

    dispose();
    expect(outputs.get('term-1')).toBeNull();

    log.set('late output');
    expect(outputs.get('term-1')).toBeNull();
  });
});

describe('permissionModePresentation', () => {
  it.each([
    ['codex', 'read-only', 'ask'],
    ['codex', 'agent', 'approve'],
    ['codex', 'agent-full-access', 'full-access'],
    ['claude', 'auto', 'approve'],
    ['claude', 'default', 'ask'],
    ['claude', 'acceptEdits', 'approve'],
    ['claude', 'plan', 'plan'],
    ['claude', 'dontAsk', 'ask'],
    ['claude', 'bypassPermissions', 'full-access'],
    ['opencode', 'build', 'approve'],
    ['opencode', 'plan', 'plan'],
  ] as const)('maps the known %s harness mode %s', (providerId, modeId, expected) => {
    expect(permissionModePresentation(providerId, modeId, 'Original')).toMatchObject({
      iconKind: expected,
    });
  });

  it('uses the approval icon for unknown future harness modes', () => {
    expect(permissionModePresentation('claude', 'custom', 'Custom')).toEqual({
      iconKind: 'approve',
      name: 'Custom',
    });
  });

  it('does not interpret mode IDs from another provider', () => {
    expect(permissionModePresentation('opencode', 'bypassPermissions', 'Bypass').iconKind).toBe(
      'approve'
    );
    expect(permissionModePresentation('claude', 'agent-full-access', 'Agent').iconKind).toBe(
      'approve'
    );
  });

  it.each([
    ['build', 'Build'],
    ['plan', 'Plan'],
  ])('formats the OpenCode %s mode name as %s', (modeId, expected) => {
    expect(permissionModePresentation('opencode', modeId, modeId).name).toBe(expected);
  });
});
