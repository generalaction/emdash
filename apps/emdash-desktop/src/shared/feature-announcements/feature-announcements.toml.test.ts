import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_ANNOUNCEMENT_CTA_ACTIONS,
  FEATURE_ANNOUNCEMENT_HEROES,
} from '@shared/feature-announcements/constants';
import { featureAnnouncementManifestSchema } from '@shared/feature-announcements/schema';

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../feature-announcements.toml'
);
const editorSchemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../feature-announcements.schema.json'
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

  it('keeps the editor JSON schema aligned with the runtime contract', async () => {
    const schema = JSON.parse(await readFile(editorSchemaPath, 'utf8')) as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { enum?: string[] }>;
      $defs?: {
        feature?: {
          additionalProperties?: boolean;
          properties?: Record<string, { enum?: string[] }>;
        };
        cta?: { additionalProperties?: boolean; properties?: Record<string, { enum?: string[] }> };
      };
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['id', 'title', 'changelogUrl', 'features']);
    expect(schema.properties?.hero?.enum).toEqual([...FEATURE_ANNOUNCEMENT_HEROES]);
    expect(schema.$defs?.feature?.additionalProperties).toBe(false);
    expect(schema.$defs?.feature?.required).toEqual(['title', 'description']);
    expect(schema.$defs?.cta?.additionalProperties).toBe(false);
    expect(schema.$defs?.cta?.properties?.action?.enum).toEqual([
      ...FEATURE_ANNOUNCEMENT_CTA_ACTIONS,
    ]);
  });
});
