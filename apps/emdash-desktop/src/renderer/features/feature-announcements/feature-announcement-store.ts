import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  clearAnnouncementDismissal,
  initializeFreshInstallAnnouncement,
  markAnnouncementDismissed,
  readAnnouncementDismissalState,
} from '@renderer/features/feature-announcements/feature-announcement-state';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

export class FeatureAnnouncementStore {
  manifest: FeatureAnnouncementManifest | null = null;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  isPreview = false;
  previewVisible = true;
  dismissedIds = new Set<string>();

  constructor() {
    makeObservable(this, {
      manifest: observable,
      status: observable,
      isPreview: observable,
      previewVisible: observable,
      dismissedIds: observable,
      shouldShowInSidebar: computed,
      dismiss: action,
      setManifest: action,
      setStatus: action,
    });
  }

  get shouldShowInSidebar(): boolean {
    if (!this.manifest || this.status !== 'ready') return false;
    if (this.isPreview) return this.previewVisible;
    return !this.dismissedIds.has(this.manifest.id);
  }

  setManifest(manifest: FeatureAnnouncementManifest | null): void {
    this.manifest = manifest;
  }

  setStatus(status: FeatureAnnouncementStore['status']): void {
    this.status = status;
  }

  async dismiss(): Promise<void> {
    if (!this.manifest) return;
    if (this.isPreview) {
      this.previewVisible = false;
      return;
    }
    const announcementId = this.manifest.id;
    if (this.dismissedIds.has(announcementId)) return;
    this.dismissedIds = new Set([...this.dismissedIds, announcementId]);
    await markAnnouncementDismissed(announcementId);
  }

  async replayPreview(): Promise<void> {
    this.previewVisible = true;
    await this.refresh({ preview: true });
  }

  async clearDismissal(): Promise<void> {
    if (!this.manifest) return;
    const announcementId = this.manifest.id;
    this.dismissedIds = new Set([...this.dismissedIds].filter((id) => id !== announcementId));
    await clearAnnouncementDismissal(announcementId);
  }

  async start(options?: { isFreshInstall?: boolean }): Promise<void> {
    await Promise.all([this.refresh(), this.loadDismissalState()]);

    if (options?.isFreshInstall) {
      await initializeFreshInstallAnnouncement({
        announcementId: this.manifest?.id,
        isFreshInstall: true,
      });
      await this.loadDismissalState();
    }
  }

  async loadDismissalState(): Promise<void> {
    const settings = await readAnnouncementDismissalState();
    runInAction(() => {
      this.dismissedIds = new Set(settings.dismissedIds);
    });
  }

  async refresh(options?: { preview?: boolean }): Promise<void> {
    const { rpc } = await import('@renderer/lib/ipc');

    runInAction(() => {
      this.status = 'loading';
      this.isPreview = Boolean(options?.preview);
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
    this.dismissedIds = new Set([...this.dismissedIds, id]);
  }
}
