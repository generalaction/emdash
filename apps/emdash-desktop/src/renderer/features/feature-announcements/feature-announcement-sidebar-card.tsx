import { ChevronRight, XIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { handleFeatureAnnouncementCtaAction } from '@renderer/features/feature-announcements/feature-announcement-actions';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';

export const FeatureAnnouncementSidebarCard = observer(function FeatureAnnouncementSidebarCard() {
  const store = appState.featureAnnouncements;

  if (!store.shouldShowInSidebar || !store.manifest) {
    return null;
  }

  const manifest = store.manifest;

  const handleDismiss = () => {
    void store.dismiss();
  };

  const handleOpen = () => {
    if (manifest.cta?.action) {
      handleFeatureAnnouncementCtaAction(manifest.cta.action);
      void store.dismiss();
      return;
    }

    if (manifest.cta?.url) {
      confirmOpenExternalLink(manifest.cta.url);
      void store.dismiss();
      return;
    }

    const url = manifest.learnMoreUrl ?? manifest.changelogUrl;
    confirmOpenExternalLink(url);
  };

  const handleChangelog = () => {
    confirmOpenExternalLink(manifest.changelogUrl);
  };

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="relative px-3 pt-2.5 pb-2.5">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-1.5 right-1.5 rounded-md p-1 text-foreground-passive transition-colors hover:text-foreground-tertiary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Dismiss announcement"
        >
          <XIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleOpen}
          className="w-full pr-6 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
        >
          <p className="text-[11px] font-medium text-primary">{manifest.eyebrow}</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{manifest.title}</p>
        </button>
      </div>
      <div className="border-t border-border">
        <button
          type="button"
          onClick={handleChangelog}
          className={cn(
            'flex w-full items-center justify-between px-3 py-2 text-xs text-foreground-muted',
            'transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary'
          )}
        >
          Changelog
          <ChevronRight className="size-3.5 shrink-0" />
        </button>
      </div>
    </div>
  );
});
