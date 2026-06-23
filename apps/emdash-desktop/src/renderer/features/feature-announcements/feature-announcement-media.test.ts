import { describe, expect, it } from 'vitest';
import { resolveFeatureAnnouncementMedia } from '@renderer/features/feature-announcements/feature-announcement-media';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

const baseManifest: FeatureAnnouncementManifest = {
  enabled: true,
  id: 'test',
  eyebrow: 'Now available',
  title: 'Test',
  changelogUrl: 'https://emdash.sh/changelog',
  features: [{ icon: 'sparkles', title: 'Feature', description: 'Description.' }],
};

describe('resolveFeatureAnnouncementMedia', () => {
  it('prefers remote image URLs over built-in hero components', () => {
    expect(
      resolveFeatureAnnouncementMedia({
        ...baseManifest,
        hero: 'automations',
        image: 'https://emdash.sh/media/automations-hero.png',
      })
    ).toEqual({
      kind: 'image',
      url: 'https://emdash.sh/media/automations-hero.png',
    });
  });

  it('falls back to coded hero components when no image is set', () => {
    expect(
      resolveFeatureAnnouncementMedia({
        ...baseManifest,
        hero: 'automations',
      })
    ).toEqual({
      kind: 'hero',
      hero: 'automations',
    });
  });

  it('returns null when neither image nor hero is configured', () => {
    expect(resolveFeatureAnnouncementMedia(baseManifest)).toBeNull();
  });
});
