import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';
import type {
  FeatureAnnouncementHero,
  FeatureAnnouncementManifest,
} from '@shared/feature-announcements/schema';

function AutomationsHeroGraphic() {
  return (
    <div className="pointer-events-none w-60 rounded-lg bg-white p-1 text-xs shadow-2xl select-none">
      <div className="flex items-center justify-between rounded-md bg-neutral-200/80 px-2.5 py-1.5">
        <span className="font-medium text-neutral-900">Nightly dependency audit</span>
        <span className="size-1.5 rounded-full bg-emerald-500" />
      </div>
      <div className="flex items-center justify-between px-2.5 py-1.5 text-neutral-600">
        <span>Triage new issues</span>
        <span className="text-neutral-400">daily 9:00</span>
      </div>
      <div className="flex items-center justify-between px-2.5 py-1.5 text-neutral-600">
        <span>Weekly changelog draft</span>
        <span className="text-neutral-400">Mon 8:00</span>
      </div>
    </div>
  );
}

const HERO_COMPONENTS: Record<FeatureAnnouncementHero, () => ReactNode> = {
  automations: AutomationsHeroGraphic,
};

export type FeatureAnnouncementMedia =
  | { kind: 'image'; url: string }
  | { kind: 'hero'; hero: FeatureAnnouncementHero };

export function resolveFeatureAnnouncementMedia(
  manifest: FeatureAnnouncementManifest
): FeatureAnnouncementMedia | null {
  if (manifest.image) {
    return { kind: 'image', url: manifest.image };
  }

  if (manifest.hero) {
    return { kind: 'hero', hero: manifest.hero };
  }

  return null;
}

export function FeatureAnnouncementMediaArea({ media }: { media: FeatureAnnouncementMedia }) {
  if (media.kind === 'image') {
    return (
      <div className="relative h-28 shrink-0 overflow-hidden rounded-t-xl bg-neutral-950">
        <img
          src={media.url}
          alt=""
          className="absolute inset-0 size-full object-cover object-center"
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.15),transparent_70%)]" />
      </div>
    );
  }

  const HeroGraphic = HERO_COMPONENTS[media.hero];
  if (!HeroGraphic) return null;

  return (
    <div
      className={cn(
        'relative flex h-28 shrink-0 items-center justify-center overflow-hidden rounded-t-xl bg-neutral-950'
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_65%)]" />
      <div className="scale-80">
        <HeroGraphic />
      </div>
    </div>
  );
}

export function getFeatureAnnouncementMedia(
  manifest: FeatureAnnouncementManifest
): FeatureAnnouncementMedia | null {
  return resolveFeatureAnnouncementMedia(manifest);
}
