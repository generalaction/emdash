import z from 'zod';
import { FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS } from './constants';

const featureAnnouncementIconSchema = z.enum([
  'calendar-clock',
  'list-checks',
  'shield',
  'check',
  'sparkles',
  'message-square',
]);

const featureAnnouncementViewSchema = z.enum(FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS);

const featureAnnouncementHeroSchema = z.enum(['automations']);

const featureAnnouncementFeatureSchema = z.object({
  icon: featureAnnouncementIconSchema,
  title: z.string().min(1),
  description: z.string().min(1),
});

const featureAnnouncementCtaSchema = z
  .object({
    label: z.string().min(1),
    view: featureAnnouncementViewSchema.optional(),
    url: z.url().optional(),
  })
  .refine((cta) => Boolean(cta.view) !== Boolean(cta.url), {
    message: 'CTA must specify exactly one of view or url',
  });

export const featureAnnouncementManifestSchema = z.object({
  enabled: z.boolean().default(false),
  id: z.string().min(1),
  eyebrow: z.string().min(1).default('Now available'),
  title: z.string().min(1),
  hero: featureAnnouncementHeroSchema.optional(),
  image: z.url().optional(),
  changelogUrl: z.url(),
  learnMoreUrl: z.url().optional(),
  minAppVersion: z.string().min(1).optional(),
  features: z.array(featureAnnouncementFeatureSchema).min(1).max(4),
  cta: featureAnnouncementCtaSchema.optional(),
});

export type FeatureAnnouncementHero = z.infer<typeof featureAnnouncementHeroSchema>;

export type FeatureAnnouncementIcon = z.infer<typeof featureAnnouncementIconSchema>;
export type FeatureAnnouncementFeature = z.infer<typeof featureAnnouncementFeatureSchema>;
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
