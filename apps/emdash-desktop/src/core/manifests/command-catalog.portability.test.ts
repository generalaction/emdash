// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('COMMAND_CATALOG portability', () => {
  it('loads without browser globals', async () => {
    expect(globalThis.document).toBeUndefined();
    const { COMMAND_CATALOG } = await import('./command-catalog');
    expect(COMMAND_CATALOG.defs.length).toBeGreaterThan(0);
  });
});
