import { describe, expect, it } from 'vitest';
import {
  buildBrowserAnnotationCaptureScript,
  parseBrowserAnnotationCaptureResult,
  withAreaBoundingBox,
} from './browser-annotation-capture';

describe('parseBrowserAnnotationCaptureResult', () => {
  it('accepts a valid capture payload', () => {
    const result = parseBrowserAnnotationCaptureResult({
      kind: 'element',
      url: 'http://localhost:3000',
      title: 'Home',
      elementPath: 'main > button',
      element: 'button',
      cssClasses: 'primary',
      nearbyText: 'Save',
      x: 10,
      y: 20,
      boundingBox: { x: 8, y: 16, width: 100, height: 32 },
    });

    expect(result).toEqual({
      kind: 'element',
      url: 'http://localhost:3000',
      title: 'Home',
      elementPath: 'main > button',
      element: 'button',
      cssClasses: 'primary',
      nearbyText: 'Save',
      selectedText: undefined,
      x: 10,
      y: 20,
      boundingBox: { x: 8, y: 16, width: 100, height: 32 },
    });
  });

  it('rejects incomplete payloads', () => {
    expect(parseBrowserAnnotationCaptureResult({ kind: 'element' })).toBeNull();
    expect(
      parseBrowserAnnotationCaptureResult({
        kind: 'element',
        url: 'http://localhost:3000',
        elementPath: 'main',
        element: 'main',
        x: 0,
        y: 0,
        boundingBox: { x: 0, y: 0, width: Number.NaN, height: 1 },
      })
    ).toBeNull();
  });
});

describe('withAreaBoundingBox', () => {
  it('overrides the kind and box while preserving page metadata', () => {
    const target = parseBrowserAnnotationCaptureResult({
      kind: 'element',
      url: 'http://localhost:3000',
      elementPath: 'main > section',
      element: 'section',
      x: 5,
      y: 5,
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    });

    expect(target).not.toBeNull();
    if (!target) throw new Error('Expected valid capture target');
    expect(withAreaBoundingBox(target, { x: 10, y: 20, width: 30, height: 40 })).toMatchObject({
      kind: 'area',
      url: 'http://localhost:3000',
      elementPath: 'main > section',
      x: 25,
      y: 40,
      boundingBox: { x: 10, y: 20, width: 30, height: 40 },
    });
  });
});

describe('buildBrowserAnnotationCaptureScript', () => {
  it('embeds sanitized coordinates and fallback kind', () => {
    const script = buildBrowserAnnotationCaptureScript(12.8, Number.POSITIVE_INFINITY, 'area');

    expect(script).toContain('const pointX = 13;');
    expect(script).toContain('const pointY = 0;');
    expect(script).toContain('const fallbackKind = "area";');
  });
});
