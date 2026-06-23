import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  clearAnnouncementDismissal,
  initializeFreshInstallAnnouncement,
  isAnnouncementDismissed,
  markAnnouncementDismissed,
} from '@renderer/features/feature-announcements/feature-announcement-state';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

export class FeatureAnnouncementStore {
  manifest: FeatureAnnouncementManifest | null = null;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  isPreview = false;
  private hasPresented = false;

  constructor() {
    makeObservable<this, 'hasPresented'>(this, {
      manifest: observable,
      status: observable,
      isPreview: observable,
      hasPresented: observable,
      shouldPresent: computed,
      markPresented: action,
      resetPresentation: action,
      setManifest: action,
      setStatus: action,
    });
  }

  get shouldPresent(): boolean {
    if (!this.manifest || this.hasPresented) return false;
    if (this.isPreview) return true;
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
    if (!this.manifest) return;
    this.hasPresented = true;
    if (!this.isPreview) {
      markAnnouncementDismissed(this.manifest.id);
    }
  }

  async replayPreview(): Promise<void> {
    await this.refresh({ preview: true });
    if (!this.manifest) return;
    this.resetPresentation();
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
      this.isPreview = Boolean(options?.preview);
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

  /** @internal test helper */
  dismissForTest(id: string): void {
    markAnnouncementDismissed(id);
  }
}
