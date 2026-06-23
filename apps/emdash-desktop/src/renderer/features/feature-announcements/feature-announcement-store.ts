import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  clearAnnouncementDismissal,
  initializeFreshInstallAnnouncement,
  isAnnouncementDismissed,
  markAnnouncementDismissed,
} from '@renderer/features/feature-announcements/feature-announcement-state';
import {
  FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS,
  type FeatureAnnouncementNavigableView,
} from '@shared/feature-announcements/constants';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

function isNavigableView(value: string): value is FeatureAnnouncementNavigableView {
  return (FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS as readonly string[]).includes(value);
}

export class FeatureAnnouncementStore {
  manifest: FeatureAnnouncementManifest | null = null;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private hasPresented = false;

  constructor() {
    makeObservable(this, {
      manifest: observable,
      status: observable,
      shouldPresent: computed,
      markPresented: action,
      resetPresentation: action,
      setManifest: action,
      setStatus: action,
    });
  }

  get shouldPresent(): boolean {
    if (!this.manifest || this.hasPresented) return false;
    return !isAnnouncementDismissed(this.manifest.id);
  }

  setManifest(manifest: FeatureAnnouncementManifest | null): void {
    this.manifest = manifest;
  }

  setStatus(status: FeatureAnnouncementStore['status']): void {
    this.status = status;
  }

  resetPresentation(): void {
    this.hasPresented = false;
  }

  markPresented(): void {
    this.hasPresented = true;
  }

  present(options?: { preview?: boolean }): void {
    if (!this.manifest) return;

    void import('@renderer/features/feature-announcements/present-feature-announcement').then(
      ({ presentFeatureAnnouncement }) => {
        presentFeatureAnnouncement(this.manifest!, () => {
          if (options?.preview) {
            this.resetPresentation();
          }
        });
      }
    );

    this.markPresented();
    if (!options?.preview) {
      markAnnouncementDismissed(this.manifest.id);
    }
  }

  async replayPreview(): Promise<void> {
    await this.refresh({ preview: true });
    if (!this.manifest) return;
    this.resetPresentation();
    this.present({ preview: true });
  }

  clearDismissal(): void {
    if (!this.manifest) return;
    clearAnnouncementDismissal(this.manifest.id);
    this.resetPresentation();
  }

  async start(options?: { isFreshInstall?: boolean }): Promise<void> {
    await this.refresh();

    if (this.manifest && options?.isFreshInstall) {
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
