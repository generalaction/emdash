import { describe, expect, it } from 'vitest';
import { isInternalAppUrl } from './external-link-policy';

const DEV_RENDERER_URL = 'http://localhost:5173';
const PACKAGED_RENDERER_URL = 'app://emdash/index.html';

describe('isInternalAppUrl', () => {
  describe('packaged app (app:// renderer)', () => {
    it('treats the app origin as internal', () => {
      expect(isInternalAppUrl('app://emdash/index.html', PACKAGED_RENDERER_URL)).toBe(true);
      expect(isInternalAppUrl('app://emdash/assets/x.js', PACKAGED_RENDERER_URL)).toBe(true);
    });

    it('does not treat localhost dev servers as internal', () => {
      expect(isInternalAppUrl('http://localhost:3000/', PACKAGED_RENDERER_URL)).toBe(false);
      expect(isInternalAppUrl('http://localhost:3000', PACKAGED_RENDERER_URL)).toBe(false);
      expect(isInternalAppUrl('http://127.0.0.1:5173/app', PACKAGED_RENDERER_URL)).toBe(false);
      expect(isInternalAppUrl('http://LOCALHOST:8080/', PACKAGED_RENDERER_URL)).toBe(false);
    });

    it('does not treat file URLs or remote sites as internal', () => {
      expect(isInternalAppUrl('file:///tmp/index.html', PACKAGED_RENDERER_URL)).toBe(false);
      expect(isInternalAppUrl('https://github.com/x', PACKAGED_RENDERER_URL)).toBe(false);
    });
  });

  describe('dev app (Vite renderer on localhost)', () => {
    it('treats the Vite origin as internal', () => {
      expect(isInternalAppUrl('http://localhost:5173/', DEV_RENDERER_URL)).toBe(true);
      expect(isInternalAppUrl('http://localhost:5173/src/main.tsx', DEV_RENDERER_URL)).toBe(true);
    });

    it('does not treat other localhost ports or hosts as internal', () => {
      expect(isInternalAppUrl('http://localhost:51730/', DEV_RENDERER_URL)).toBe(false);
      expect(isInternalAppUrl('http://localhost:3000/', DEV_RENDERER_URL)).toBe(false);
      expect(isInternalAppUrl('http://127.0.0.1:5173/', DEV_RENDERER_URL)).toBe(false);
    });
  });

  it('rejects unparsable URLs', () => {
    expect(isInternalAppUrl('not a url', PACKAGED_RENDERER_URL)).toBe(false);
    expect(isInternalAppUrl('', PACKAGED_RENDERER_URL)).toBe(false);
  });
});
