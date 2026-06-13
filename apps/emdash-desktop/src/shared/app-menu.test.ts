import { describe, expect, it } from 'vitest';
import { COMPACT_APP_MENU, listCompactMenuActionIds } from './app-menu';

describe('COMPACT_APP_MENU', () => {
  it('matches the desktop menu bar groups used on Windows', () => {
    expect(COMPACT_APP_MENU.map((group) => group.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Window',
      'Help',
    ]);
  });

  it('does not reuse action ids across menu items', () => {
    const actionIds = listCompactMenuActionIds(COMPACT_APP_MENU);
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });
});
