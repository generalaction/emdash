import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  AnnotatedElementInfo,
  AnnotationDraft,
  AnnotationRect,
  AnnotationTrackedRect,
  BrowserAnnotation,
} from './browser-annotation-types';

export type AnnotationMarker = {
  token: number;
  ordinal: number;
  comment: string;
  rect: AnnotationRect;
};

export class BrowserAnnotationState {
  picking = false;
  draft: AnnotationDraft | null = null;
  annotations: BrowserAnnotation[] = [];
  /** Live viewport rects per token, updated by the in-page picker on scroll/resize. */
  readonly liveRects = observable.map<number, AnnotationRect | null>();
  /**
   * Incremented on each full navigation. The in-page picker context (and its token
   * counter) resets with the page, so tokens are only unique within one epoch; markers
   * render only for the current epoch.
   */
  navigationEpoch = 0;

  constructor() {
    makeObservable(this, {
      picking: observable,
      draft: observable,
      annotations: observable,
      navigationEpoch: observable,
      markers: computed,
      setPicking: action,
      startDraft: action,
      cancelDraft: action,
      commitDraft: action,
      removeAnnotation: action,
      clearAll: action,
      applyRects: action,
      handleNavigation: action,
    });
  }

  get markers(): AnnotationMarker[] {
    const markers: AnnotationMarker[] = [];
    for (const annotation of this.annotations) {
      if (annotation.epoch !== this.navigationEpoch) continue;
      const live = this.liveRects.has(annotation.token)
        ? this.liveRects.get(annotation.token)
        : annotation.element.rect;
      if (!live) continue;
      markers.push({
        token: annotation.token,
        ordinal: markers.length + 1,
        comment: annotation.comment,
        rect: live,
      });
    }
    return markers;
  }

  setPicking(active: boolean): void {
    this.picking = active;
  }

  startDraft(token: number, element: AnnotatedElementInfo, pageUrl: string): void {
    this.draft = { token, element, pageUrl };
  }

  cancelDraft(): AnnotationDraft | null {
    const draft = this.draft;
    this.draft = null;
    return draft;
  }

  commitDraft(comment: string): BrowserAnnotation | null {
    const draft = this.draft;
    const trimmed = comment.trim();
    if (!draft || !trimmed) return null;
    const annotation: BrowserAnnotation = {
      token: draft.token,
      epoch: this.navigationEpoch,
      comment: trimmed,
      element: draft.element,
      pageUrl: draft.pageUrl,
    };
    this.annotations.push(annotation);
    this.draft = null;
    return annotation;
  }

  /** Removes by (epoch, token) — page tokens repeat across navigations. */
  removeAnnotation(token: number, epoch: number = this.navigationEpoch): void {
    this.annotations = this.annotations.filter(
      (annotation) => annotation.token !== token || annotation.epoch !== epoch
    );
    if (epoch === this.navigationEpoch) this.liveRects.delete(token);
  }

  clearAll(): void {
    this.picking = false;
    this.annotations = [];
    this.draft = null;
    this.liveRects.clear();
  }

  applyRects(rects: AnnotationTrackedRect[]): void {
    for (const entry of rects) {
      this.liveRects.set(entry.token, entry.attached ? entry.rect : null);
    }
  }

  handleNavigation(): void {
    this.picking = false;
    this.draft = null;
    this.liveRects.clear();
    this.navigationEpoch += 1;
  }
}

export class BrowserAnnotationStore {
  private readonly states = observable.map<string, BrowserAnnotationState>();

  get(browserId: string): BrowserAnnotationState {
    const existing = this.states.get(browserId);
    if (existing) return existing;
    const state = new BrowserAnnotationState();
    runInAction(() => {
      this.states.set(browserId, state);
    });
    return state;
  }

  remove(browserId: string): void {
    runInAction(() => {
      this.states.delete(browserId);
    });
  }
}

export const browserAnnotationStore = new BrowserAnnotationStore();
