import { Hand, ListTodo, ShieldAlert, ShieldCheck } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { PermissionModeIcon } from './permission-mode-icon';

describe('PermissionModeIcon', () => {
  it.each([
    ['ask', Hand],
    ['approve', ShieldCheck],
    ['plan', ListTodo],
    ['full-access', ShieldAlert],
  ] as const)('renders the icon supplied by the host for %s', (kind, expected) => {
    expect(PermissionModeIcon({ kind }).type).toBe(expected);
  });

  it('defaults to the approval icon', () => {
    expect(PermissionModeIcon({}).type).toBe(ShieldCheck);
  });
});
