import z from 'zod';
import { FEATURE_ANNOUNCEMENT_CTA_ACTIONS } from './constants';

const featureAnnouncementCtaActionSchema = z.enum(FEATURE_ANNOUNCEMENT_CTA_ACTIONS);

const featureAnnouncementCtaSchema = z
  .object({
    action: featureAnnouncementCtaActionSchema.optional(),
    url: z.url().optional(),
  })
  .refine((cta) => Boolean(cta.action) !== Boolean(cta.url), {
    message: 'CTA must specify exactly one of action or url',
  })
  .strict();

export const featureAnnouncementManifestSchema = z
  .object({
    enabled: z.boolean().default(false),
    id: z.string().min(1),
    eyebrow: z.string().min(1).default('Now available'),
    title: z.string().min(1),
    changelogUrl: z.url(),
    minAppVersion: z.string().min(1).optional(),
    cta: featureAnnouncementCtaSchema.optional(),
  })
  .strict();

export type FeatureAnnouncementCta = z.infer<typeof featureAnnouncementCtaSchema>;
export type FeatureAnnouncementManifest = z.infer<typeof featureAnnouncementManifestSchema>;

export function parseFeatureAnnouncementManifest(raw: unknown): FeatureAnnouncementManifest | null {
  const parsed = featureAnnouncementManifestSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (!parsed.data.enabled) return null;
  return parsed.data;
}

export function parseFeatureAnnouncementManifestRaw(
  raw: unknown
): FeatureAnnouncementManifest | null {
  const parsed = featureAnnouncementManifestSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

/** Validates manifest shape and throws with Zod error details (tests/CI). */
export function assertFeatureAnnouncementManifest(raw: unknown): FeatureAnnouncementManifest {
  return featureAnnouncementManifestSchema.parse(raw);
}
