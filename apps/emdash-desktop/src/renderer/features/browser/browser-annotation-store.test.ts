import { describe, expect, it } from 'vitest';
import { BrowserAnnotationState } from './browser-annotation-store';
import type { AnnotatedElementInfo } from './browser-annotation-types';

function makeElement(overrides: Partial<AnnotatedElementInfo> = {}): AnnotatedElementInfo {
  return {
    selector: 'button.primary',
    tag: 'button',
    id: null,
    classes: ['primary'],
    testId: null,
    role: null,
    text: 'Submit',
    html: '<button class="primary">Submit</button>',
    rect: { x: 10, y: 20, width: 100, height: 32 },
    component: null,
    source: null,
    styles: {},
    ...overrides,
  };
}

describe('BrowserAnnotationState', () => {
  it('commits a draft into an annotation with a trimmed comment', () => {
    const state = new BrowserAnnotationState();
    state.startDraft(1, makeElement(), 'http://localhost:5173/');

    const annotation = state.commitDraft('  Make it blue  ');

    expect(annotation?.comment).toBe('Make it blue');
    expect(state.draft).toBeNull();
    expect(state.annotations).toHaveLength(1);
    expect(state.markers).toEqual([
      {
        token: 1,
        ordinal: 1,
        comment: 'Make it blue',
        rect: { x: 10, y: 20, width: 100, height: 32 },
      },
    ]);
  });

  it('rejects committing an empty comment and keeps the draft', () => {
    const state = new BrowserAnnotationState();
    state.startDraft(1, makeElement(), 'http://localhost:5173/');

    expect(state.commitDraft('   ')).toBeNull();
    expect(state.draft).not.toBeNull();
    expect(state.annotations).toHaveLength(0);
  });

  it('returns the cancelled draft so the page tracker can be released', () => {
    const state = new BrowserAnnotationState();
    state.startDraft(4, makeElement(), 'http://localhost:5173/');

    const cancelled = state.cancelDraft();

    expect(cancelled?.token).toBe(4);
    expect(state.draft).toBeNull();
  });

  it('prefers live rects over the pick-time rect and hides detached elements', () => {
    const state = new BrowserAnnotationState();
    state.startDraft(1, makeElement(), 'http://localhost:5173/');
    state.commitDraft('First');
    state.startDraft(2, makeElement(), 'http://localhost:5173/');
    state.commitDraft('Second');

    state.applyRects([
      { token: 1, attached: true, rect: { x: 5, y: 6, width: 7, height: 8 } },
      { token: 2, attached: false, rect: null },
    ]);

    expect(state.markers).toEqual([
      { token: 1, ordinal: 1, comment: 'First', rect: { x: 5, y: 6, width: 7, height: 8 } },
    ]);
  });

  it('numbers rendered markers sequentially when an earlier element is detached', () => {
    const state = new BrowserAnnotationState();
    state.startDraft(1, makeElement(), 'http://localhost:5173/');
    state.commitDraft('First');
    state.startDraft(2, makeElement(), 'http://localhost:5173/');
    state.commitDraft('Second');

    // The first annotation's element is gone; only the second renders a marker.
    state.applyRects([
      { token: 1, attached: false, rect: null },
      { token: 2, attached: true, rect: { x: 5, y: 6, width: 7, height: 8 } },
    ]);

    expect(state.markers).toEqual([
      { token: 2, ordinal: 1, comment: 'Second', rect: { x: 5, y: 6, width: 7, height: 8 } },
    ]);
  });

  it('hides markers and resets transient state after navigation', () => {
    const state = new BrowserAnnotationState();
    state.setPicking(true);
    state.startDraft(1, makeElement(), 'http://localhost:5173/');
    state.commitDraft('Keep me');
    state.startDraft(2, makeElement(), 'http://localhost:5173/');

    state.handleNavigation();

    expect(state.picking).toBe(false);
    expect(state.draft).toBeNull();
    expect(state.markers).toEqual([]);
    expect(state.annotations).toHaveLength(1);
  });

  it('keeps old-page markers hidden when a new draft starts after navigation', () => {
    const state = new BrowserAnnotationState();
    state.startDraft(1, makeElement(), 'http://localhost:5173/');
    state.commitDraft('Old page');

    state.handleNavigation();
    state.startDraft(1, makeElement(), 'http://localhost:5173/about');

    expect(state.markers).toEqual([]);
  });

  it('disambiguates colliding page tokens across navigations', () => {
    const state = new BrowserAnnotationState();
    state.startDraft(1, makeElement(), 'http://localhost:5173/');
    state.commitDraft('Old page');

    state.handleNavigation();
    state.startDraft(1, makeElement(), 'http://localhost:5173/about');
    state.commitDraft('New page');

    expect(state.annotations).toHaveLength(2);
    // Only the current epoch's annotation renders a marker, numbered from 1.
    expect(state.markers).toHaveLength(1);
    expect(state.markers[0]?.comment).toBe('New page');
    expect(state.markers[0]?.ordinal).toBe(1);

    // Removing by current-epoch token must not delete the old-page annotation.
    state.removeAnnotation(1);
    expect(state.annotations.map((annotation) => annotation.comment)).toEqual(['Old page']);
  });

  it('removes and clears annotations', () => {
    const state = new BrowserAnnotationState();
    state.setPicking(true);
    state.startDraft(1, makeElement(), 'http://localhost:5173/');
    state.commitDraft('First');
    state.startDraft(2, makeElement(), 'http://localhost:5173/');
    state.commitDraft('Second');

    state.removeAnnotation(1);
    expect(state.annotations.map((annotation) => annotation.token)).toEqual([2]);
    expect(state.markers[0]?.ordinal).toBe(1);

    state.clearAll();
    expect(state.picking).toBe(false);
    expect(state.annotations).toHaveLength(0);
    expect(state.markers).toEqual([]);
  });
});
