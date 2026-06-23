import { ArrowUpRight, XIcon } from 'lucide-react';
import { getFeatureAnnouncementIcon } from '@renderer/features/feature-announcements/feature-announcement-icon';
import {
  FeatureAnnouncementMediaArea,
  getFeatureAnnouncementMedia,
} from '@renderer/features/feature-announcements/feature-announcement-media';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { DialogFooter, DialogTitle } from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

export function FeatureAnnouncementModal({
  manifest,
  onSuccess,
  onClose,
}: { manifest: FeatureAnnouncementManifest } & BaseModalProps<void>) {
  const media = getFeatureAnnouncementMedia(manifest);

  const handleLearnMore = () => {
    const url = manifest.learnMoreUrl ?? manifest.changelogUrl;
    confirmOpenExternalLink(url);
  };

  const handleCta = () => {
    if (manifest.cta?.url) {
      confirmOpenExternalLink(manifest.cta.url);
      onSuccess();
      return;
    }

    const view = appState.featureAnnouncements.resolveCtaView(manifest.cta?.view);
    if (view) {
      appState.navigation.navigate(view);
    }
    onSuccess();
  };

  return (
    <div className="group/announcement relative overflow-hidden rounded-xl">
      {media && <FeatureAnnouncementMediaArea media={media} variant="modal" />}
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'absolute top-3 right-3 z-10 rounded-full p-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          media
            ? 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
            : 'text-foreground-tertiary-muted hover:text-foreground-tertiary'
        )}
      >
        <XIcon className="size-4" />
        <span className="sr-only">Close</span>
      </button>
      <div className="flex flex-col gap-5 p-6 outline-none" tabIndex={-1} data-autofocus>
        <div>
          <p className="text-muted-foreground text-sm">{manifest.eyebrow}</p>
          <DialogTitle className="mt-1 font-sans text-xl font-semibold tracking-normal text-foreground normal-case">
            {manifest.title}
          </DialogTitle>
        </div>
        <ul className="flex flex-col gap-4">
          {manifest.features.map((feature) => {
            const Icon = getFeatureAnnouncementIcon(feature.icon);
            return (
              <li key={feature.title} className="flex gap-3">
                <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{feature.title}</p>
                  <p className="text-muted-foreground mt-0.5">{feature.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <Button variant="ghost" className="announcement-learn-more" onClick={handleLearnMore}>
          Learn more
          <ArrowUpRight className="size-3.5 transition-transform duration-200 group-has-[.announcement-learn-more:hover]/announcement:translate-x-px group-has-[.announcement-learn-more:hover]/announcement:-translate-y-px" />
        </Button>
        {manifest.cta ? (
          <Button onClick={handleCta}>{manifest.cta.label}</Button>
        ) : (
          <Button onClick={onClose}>Got it</Button>
        )}
      </DialogFooter>
    </div>
  );
}
