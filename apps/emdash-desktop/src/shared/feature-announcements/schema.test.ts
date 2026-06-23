import { describe, expect, it } from 'vitest';
import {
  parseFeatureAnnouncementManifest,
  parseFeatureAnnouncementManifestRaw,
} from '@shared/feature-announcements/schema';

const sampleManifest = {
  enabled: true,
  id: 'automations-2026-06',
  eyebrow: 'Now available',
  title: 'Emdash Automations',
  changelogUrl: 'https://emdash.sh/changelog',
  learnMoreUrl: 'https://docs.emdash.sh',
  minAppVersion: '1.1.27',
  features: [
    {
      icon: 'calendar-clock',
      title: 'Run agents on a schedule',
      description: 'Launch coding agents on a cron.',
    },
  ],
  cta: {
    label: 'Open Automations',
    view: 'automations',
  },
};

describe('feature announcement schema', () => {
  it('parses enabled manifests', () => {
    expect(parseFeatureAnnouncementManifest(sampleManifest)).toEqual(sampleManifest);
  });

  it('returns null for disabled manifests', () => {
    expect(parseFeatureAnnouncementManifest({ ...sampleManifest, enabled: false })).toBeNull();
  });

  it('allows preview parsing when disabled', () => {
    expect(parseFeatureAnnouncementManifestRaw({ ...sampleManifest, enabled: false })).toEqual({
      ...sampleManifest,
      enabled: false,
    });
  });

  it('rejects invalid CTA definitions', () => {
    expect(
      parseFeatureAnnouncementManifest({
        ...sampleManifest,
        cta: { label: 'Broken', view: 'automations', url: 'https://example.com' },
      })
    ).toBeNull();
  });
});
