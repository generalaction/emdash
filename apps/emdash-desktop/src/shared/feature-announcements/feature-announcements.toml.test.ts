import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { featureAnnouncementManifestSchema } from '@shared/feature-announcements/schema';

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../feature-announcements.toml'
);

describe('feature-announcements.toml', () => {
  it('matches the Zod manifest schema', async () => {
    const content = await readFile(manifestPath, 'utf8');
    const parsed = parse(content);
    const result = featureAnnouncementManifestSchema.safeParse(parsed);

    expect(
      result.success,
      result.success ? undefined : JSON.stringify(result.error.format(), null, 2)
    ).toBe(true);
  });
});
