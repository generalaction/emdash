import { expect, it } from 'vitest';
import { lspCapabilitiesSchema } from './schemas';

it('reads capabilities from hosts that predate formatting as non-formatting', () => {
  const legacy = { hover: true, definition: true, typeDefinition: false, references: true };
  expect(lspCapabilitiesSchema.parse(legacy).formatting).toBe(false);
});
