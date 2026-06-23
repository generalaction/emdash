import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY,
  FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS,
  type FeatureAnnouncementNavigableView,
} from '@shared/feature-announcements/constants';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

function readDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function writeDismissedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(
      FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY,
      JSON.stringify([...ids].sort())
    );
  } catch {
    // localStorage may be unavailable
  }
}

function isNavigableView(value: string): value is FeatureAnnouncementNavigableView {
  return (FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS as readonly string[]).includes(value);
}

export class FeatureAnnouncementStore {
  manifest: FeatureAnnouncementManifest | null = null;
  dismissedIds = readDismissedIds();
  previewMode = false;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

  constructor() {
    makeObservable(this, {
      manifest: observable,
      dismissedIds: observable,
      previewMode: observable,
      status: observable,
      visibleManifest: computed,
      dismiss: action,
      preview: action,
      clearPreview: action,
      setManifest: action,
      setStatus: action,
    });
  }

  get visibleManifest(): FeatureAnnouncementManifest | null {
    if (!this.manifest) return null;
    if (this.previewMode) return this.manifest;
    if (this.dismissedIds.has(this.manifest.id)) return null;
    return this.manifest;
  }

  setManifest(manifest: FeatureAnnouncementManifest | null): void {
    this.manifest = manifest;
  }

  setStatus(status: FeatureAnnouncementStore['status']): void {
    this.status = status;
  }

  dismiss(): void {
    if (!this.manifest) return;
    this.dismissedIds = new Set([...this.dismissedIds, this.manifest.id]);
    writeDismissedIds(this.dismissedIds);
    this.previewMode = false;
  }

  preview(manifest: FeatureAnnouncementManifest): void {
    this.manifest = manifest;
    this.previewMode = true;
  }

  clearPreview(): void {
    this.previewMode = false;
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(options?: { preview?: boolean }): Promise<void> {
    const { rpc } = await import('@renderer/lib/ipc');

    runInAction(() => {
      this.status = 'loading';
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
        this.previewMode = Boolean(options?.preview && response.data);
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
}
