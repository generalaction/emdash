import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  clearAnnouncementDismissal,
  initializeFreshInstallAnnouncement,
  isAnnouncementDismissed,
  markAnnouncementDismissed,
} from '@renderer/features/feature-announcements/feature-announcement-state';
import {
  FEATURE_ANNOUNCEMENT_DEV_REPEAT_ON_LAUNCH_KEY,
  FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS,
  type FeatureAnnouncementNavigableView,
} from '@shared/feature-announcements/constants';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

function isNavigableView(value: string): value is FeatureAnnouncementNavigableView {
  return (FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS as readonly string[]).includes(value);
}

function readDevRepeatOnLaunch(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(FEATURE_ANNOUNCEMENT_DEV_REPEAT_ON_LAUNCH_KEY) === 'true';
  } catch {
    return false;
  }
}

export class FeatureAnnouncementStore {
  manifest: FeatureAnnouncementManifest | null = null;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  devRepeatOnLaunch = readDevRepeatOnLaunch();
  private hasPresented = false;

  constructor() {
    makeObservable(this, {
      manifest: observable,
      status: observable,
      devRepeatOnLaunch: observable,
      shouldPresent: computed,
      markPresented: action,
      resetPresentation: action,
      setDevRepeatOnLaunch: action,
      setManifest: action,
      setStatus: action,
    });
  }

  get shouldPresent(): boolean {
    if (!this.manifest || this.hasPresented) return false;
    if (import.meta.env.DEV && this.devRepeatOnLaunch) return true;
    return !isAnnouncementDismissed(this.manifest.id);
  }

  setManifest(manifest: FeatureAnnouncementManifest | null): void {
    this.manifest = manifest;
  }

  setStatus(status: FeatureAnnouncementStore['status']): void {
    this.status = status;
  }

  setDevRepeatOnLaunch(enabled: boolean): void {
    if (!import.meta.env.DEV) return;
    this.devRepeatOnLaunch = enabled;
    try {
      localStorage.setItem(
        FEATURE_ANNOUNCEMENT_DEV_REPEAT_ON_LAUNCH_KEY,
        enabled ? 'true' : 'false'
      );
    } catch {
      // localStorage may be unavailable
    }
    if (enabled) {
      this.resetPresentation();
    }
  }

  resetPresentation(): void {
    this.hasPresented = false;
  }

  markPresented(): void {
    this.hasPresented = true;
  }

  present(options?: { preview?: boolean; display?: 'modal' | 'toast' }): void {
    if (!this.manifest) return;

    const manifest =
      options?.display !== undefined
        ? { ...this.manifest, display: options.display }
        : this.manifest;

    void import('@renderer/features/feature-announcements/present-feature-announcement').then(
      ({ presentFeatureAnnouncement }) => {
        presentFeatureAnnouncement(manifest, () => {
          if (options?.preview) {
            this.resetPresentation();
          }
        });
      }
    );

    this.markPresented();
    if (!options?.preview && !(import.meta.env.DEV && this.devRepeatOnLaunch)) {
      markAnnouncementDismissed(this.manifest.id);
    }
  }

  async replayPreview(display: 'modal' | 'toast'): Promise<void> {
    await this.refresh({ preview: true });
    if (!this.manifest) return;
    this.resetPresentation();
    this.present({ preview: true, display });
  }

  clearDismissal(): void {
    if (!this.manifest) return;
    clearAnnouncementDismissal(this.manifest.id);
    this.resetPresentation();
  }

  async start(options?: { isFreshInstall?: boolean }): Promise<void> {
    await this.refresh();

    if (this.manifest && options?.isFreshInstall && !this.devRepeatOnLaunch) {
      initializeFreshInstallAnnouncement({
        announcementId: this.manifest.id,
        isFreshInstall: true,
      });
    }
  }

  async refresh(options?: { preview?: boolean }): Promise<void> {
    const { rpc } = await import('@renderer/lib/ipc');

    runInAction(() => {
      this.status = 'loading';
      if (!options?.preview) {
        this.resetPresentation();
      }
    });

    try {
      const response = options?.preview
        ? await rpc.featureAnnouncements.preview()
        : await rpc.featureAnnouncements.getCurrent();

      runInAction(() => {
        if (!response?.success) {
          this.status = 'error';
          return;
        }

        this.manifest = response.data;
        this.status = 'ready';
      });
    } catch {
      runInAction(() => {
        this.status = 'error';
      });
    }
  }

  resolveCtaView(view: string | undefined): FeatureAnnouncementNavigableView | null {
    if (!view || !isNavigableView(view)) return null;
    return view;
  }

  /** @internal test helper */
  dismissForTest(id: string): void {
    markAnnouncementDismissed(id);
  }
}
