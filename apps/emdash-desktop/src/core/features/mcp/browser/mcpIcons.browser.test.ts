import { describe, expect, it } from 'vitest';
import { resolveMcpIconKey } from './mcpIcons';

/**
 * `resolveMcpIconKey` only returns a key it has markup for, so these assertions
 * fail if the `import.meta.glob` over the icon directory stops matching. That
 * has happened before: a relative pattern kept resolving after the file moved,
 * silently emptying the map and dropping every catalog icon to the default.
 */
describe('resolveMcpIconKey', () => {
  it('finds the bundled icon for Emdash itself', () => {
    expect(resolveMcpIconKey(undefined, 'emdash')).toBe('emdash');
  });

  it('finds icons for catalog servers', () => {
    expect(resolveMcpIconKey(undefined, 'asana')).toBe('asana');
    expect(resolveMcpIconKey('chrome_devtools')).toBe('chrome_devtools');
  });

  it('has no key for a server it does not ship an icon for', () => {
    expect(resolveMcpIconKey(undefined, 'not-a-real-mcp-server')).toBeUndefined();
  });
});
