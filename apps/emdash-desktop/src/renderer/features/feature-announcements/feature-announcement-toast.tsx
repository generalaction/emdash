import { ArrowUpRight, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { getFeatureAnnouncementIcon } from '@renderer/features/feature-announcements/feature-announcement-icon';
import {
  FeatureAnnouncementMediaArea,
  getFeatureAnnouncementMedia,
} from '@renderer/features/feature-announcements/feature-announcement-media';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { FeatureAnnouncementCtaAction } from '@shared/feature-announcements/constants';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

const CUSTOM_TOAST_CLASSNAMES = {
  toast: '!border-none !bg-transparent !p-0 !shadow-none',
};

type FeatureAnnouncementToastOptions = {
  onAction?: (action: FeatureAnnouncementCtaAction) => void;
  onDismiss?: () => void;
};

export function showFeatureAnnouncementToast(
  manifest: FeatureAnnouncementManifest,
  options?: FeatureAnnouncementToastOptions
): void {
  toast.custom(
    (id) => <FeatureAnnouncementToastCard manifest={manifest} toastId={id} options={options} />,
    {
      duration: Infinity,
      classNames: CUSTOM_TOAST_CLASSNAMES,
    }
  );
}

function FeatureAnnouncementToastCard({
  manifest,
  toastId,
  options,
}: {
  manifest: FeatureAnnouncementManifest;
  toastId: string | number;
  options?: FeatureAnnouncementToastOptions;
}) {
  const media = getFeatureAnnouncementMedia(manifest);
  const dismiss = () => {
    toast.dismiss(toastId);
    options?.onDismiss?.();
  };

  const handleLearnMore = () => {
    const url = manifest.learnMoreUrl ?? manifest.changelogUrl;
    confirmOpenExternalLink(url);
  };

  const handleCta = () => {
    if (manifest.cta?.url) {
      confirmOpenExternalLink(manifest.cta.url);
      dismiss();
      return;
    }

    if (manifest.cta?.action) {
      options?.onAction?.(manifest.cta.action);
    }
    dismiss();
  };

  return (
    <div className="relative w-[356px] overflow-hidden rounded-xl bg-background-quaternary text-sm shadow-lg">
      {media && <FeatureAnnouncementMediaArea media={media} />}
      <button
        type="button"
        onClick={dismiss}
        className={cn(
          'absolute top-2 right-2 z-10 rounded-full p-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          media
            ? 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
            : 'text-foreground-tertiary-muted hover:text-foreground-tertiary'
        )}
      >
        <XIcon className="size-3.5" />
        <span className="sr-only">Close</span>
      </button>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <p className="text-muted-foreground text-xs">{manifest.eyebrow}</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{manifest.title}</p>
        </div>
        <ul className="flex flex-col gap-2.5">
          {manifest.features.map((feature) => {
            const Icon = getFeatureAnnouncementIcon(feature.icon);
            return (
              <li key={feature.title} className="flex gap-2.5">
                <Icon className="text-muted-foreground mt-px size-3.5 shrink-0" />
                <div className="min-w-0 text-xs">
                  <p className="font-medium text-foreground">{feature.title}</p>
                  <p className="text-muted-foreground mt-0.5">{feature.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex items-center justify-between border-t border-border bg-background-quaternary-1 p-2">
        <Button variant="ghost" size="xs" className="group/learn-more" onClick={handleLearnMore}>
          Learn more
          <ArrowUpRight className="size-3 transition-transform duration-200 group-hover/learn-more:translate-x-px group-hover/learn-more:-translate-y-px" />
        </Button>
        {manifest.cta ? (
          <Button size="xs" onClick={handleCta}>
            {manifest.cta.label}
          </Button>
        ) : (
          <Button size="xs" onClick={dismiss}>
            Got it
          </Button>
        )}
      </div>
    </div>
  );
}
