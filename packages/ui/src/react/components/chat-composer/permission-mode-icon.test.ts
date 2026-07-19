import { describe, expect, it } from 'vitest';
import { permissionModeIconKind } from './permission-mode-icon';

describe('permissionModeIconKind', () => {
  it.each([
    ['read-only', 'Read-only', 'ask'],
    ['agent', 'Agent', 'approve'],
    ['agent-full-access', 'Agent (full access)', 'full-access'],
    ['auto', 'Auto', 'approve'],
    ['default', 'Default', 'ask'],
    ['acceptEdits', 'Accept Edits', 'approve'],
    ['plan', 'Plan Mode', 'plan'],
    ['dontAsk', "Don't Ask", 'ask'],
    ['bypassPermissions', 'Bypass Permissions', 'full-access'],
    ['build', 'build', 'approve'],
    ['plan', 'plan', 'plan'],
  ] as const)('classifies the known harness mode %s', (id, name, expected) => {
    expect(permissionModeIconKind({ id, name })).toBe(expected);
  });

  it('uses the approval icon for unknown future harness modes', () => {
    expect(permissionModeIconKind({ id: 'custom', name: 'Custom' })).toBe('approve');
  });

  it('recognizes unrestricted modes from their descriptions', () => {
    expect(
      permissionModeIconKind({
        id: 'custom',
        name: 'Custom',
        description: 'Unrestricted access to files and commands',
      })
    ).toBe('full-access');
  });
});
