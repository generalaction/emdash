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
  minAppVersion: '1.1.27',
  cta: {
    action: 'open-automations',
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

  it('rejects removed card-only fields', () => {
    expect(
      parseFeatureAnnouncementManifest({
        ...sampleManifest,
        hero: 'automations',
        features: [{ title: 'Run agents on a schedule', description: 'Launch agents on a cron.' }],
        learnMoreUrl: 'https://docs.emdash.sh',
      })
    ).toBeNull();
  });

  it('rejects invalid CTA definitions', () => {
    expect(
      parseFeatureAnnouncementManifest({
        ...sampleManifest,
        cta: { action: 'open-automations', url: 'https://example.com' },
      })
    ).toBeNull();
  });
});
