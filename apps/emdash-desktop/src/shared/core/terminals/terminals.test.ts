import { describe, expect, it } from 'vitest';
import { createLifecycleScriptTerminalId } from './terminals';

describe('createLifecycleScriptTerminalId', () => {
  it('returns stable delimiter-safe lifecycle script terminal ids', () => {
    expect(createLifecycleScriptTerminalId('setup')).toBe('script-lifecycle-setup');
    expect(createLifecycleScriptTerminalId('run')).toBe('script-lifecycle-run');
    expect(createLifecycleScriptTerminalId('teardown')).toBe('script-lifecycle-teardown');
  });
});
