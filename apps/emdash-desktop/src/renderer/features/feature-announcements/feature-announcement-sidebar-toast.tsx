import { ChevronRight, XIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import type { FeatureAnnouncementCtaAction } from '@shared/feature-announcements/constants';

const SIDEBAR_SELECTOR = '[data-emdash-left-sidebar]';

type SidebarAnchor = {
  left: number;
  width: number;
  bottom: number;
};

function handleCtaAction(action: FeatureAnnouncementCtaAction): void {
  switch (action) {
    case 'open-automations':
      appState.navigation.navigate('automations');
      break;
  }
}

function useSidebarAnchor(enabled: boolean): SidebarAnchor | null {
  const [anchor, setAnchor] = useState<SidebarAnchor | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setAnchor(null);
      return;
    }

    const sidebar = document.querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) {
      setAnchor(null);
      return;
    }

    const sync = () => {
      const rect = sidebar.getBoundingClientRect();
      if (rect.width <= 0) {
        setAnchor(null);
        return;
      }

      setAnchor({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.bottom,
      });
    };

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(sidebar);
    window.addEventListener('resize', sync);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [enabled]);

  return anchor;
}

export const FeatureAnnouncementSidebarToast = observer(function FeatureAnnouncementSidebarToast() {
  const store = appState.featureAnnouncements;
  const { isLeftOpen } = useWorkspaceLayoutContext();
  const manifest = store.manifest;
  const enabled =
    isLeftOpen && store.status === 'ready' && Boolean(manifest) && store.shouldPresent;
  const anchor = useSidebarAnchor(enabled);

  if (!enabled || !manifest || !anchor) {
    return null;
  }

  const handleDismiss = () => {
    void store.dismiss();
  };

  const handleChangelog = () => {
    confirmOpenExternalLink(manifest.changelogUrl);
  };

  const handleTitleClick = () => {
    if (manifest.cta?.action) {
      handleCtaAction(manifest.cta.action);
      handleDismiss();
      return;
    }

    if (manifest.cta?.url) {
      confirmOpenExternalLink(manifest.cta.url);
      handleDismiss();
    }
  };

  const titleIsInteractive = Boolean(manifest.cta?.action || manifest.cta?.url);

  return createPortal(
    <div
      className="pointer-events-none fixed z-[100] px-2"
      style={{
        left: anchor.left,
        width: anchor.width,
        bottom: anchor.bottom + 40,
      }}
    >
      <div
        className={cn(
          'pointer-events-auto overflow-hidden rounded-xl border border-border/60 bg-background-quaternary shadow-lg ring-1 ring-black/5 animate-panel-blur-in'
        )}
      >
        <div className="relative px-3.5 pt-3 pb-2.5">
          <button
            type="button"
            onClick={handleDismiss}
            className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-md text-foreground-tertiary-muted transition-colors hover:bg-background-quaternary-1 hover:text-foreground-tertiary"
          >
            <XIcon className="size-3.5" />
            <span className="sr-only">Dismiss</span>
          </button>
          <p className="text-primary text-xs font-medium">{manifest.eyebrow}</p>
          {titleIsInteractive ? (
            <button
              type="button"
              onClick={handleTitleClick}
              className="mt-1 block pr-7 text-left text-sm font-semibold text-foreground hover:opacity-80"
            >
              {manifest.title}
            </button>
          ) : (
            <p className="mt-1 pr-7 text-sm font-semibold text-foreground">{manifest.title}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleChangelog}
          className={cn(
            'flex w-full items-center justify-between gap-2 border-t border-border bg-background-quaternary-1 px-3.5 py-2',
            'text-xs text-foreground-tertiary-muted transition-colors hover:text-foreground-tertiary'
          )}
        >
          Full changelog
          <ChevronRight className="size-3.5 shrink-0 opacity-70" />
        </button>
      </div>
    </div>,
    document.body
  );
});
