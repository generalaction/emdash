import { describe, expect, it } from 'vitest';
import { computeResizeDelay } from '../../renderer/terminal/resizeUtils';

const DEBOUNCE_MS = 60;

describe('computeResizeDelay', () => {
  it('returns remaining stabilization time when inside the window', () => {
    const now = 1000;
    const deadline = now + 300; // 300ms left in window
    expect(computeResizeDelay(deadline, now, DEBOUNCE_MS)).toBe(300);
  });

  it('returns debounce delay when stabilization window has expired', () => {
    const now = 1000;
    const deadline = now - 100; // window ended 100ms ago
    expect(computeResizeDelay(deadline, now, DEBOUNCE_MS)).toBe(DEBOUNCE_MS);
  });

  it('returns debounce delay when deadline is exactly now (0 remaining)', () => {
    const now = 1000;
    expect(computeResizeDelay(now, now, DEBOUNCE_MS)).toBe(DEBOUNCE_MS);
  });

  it('returns debounce delay when deadline is 0 (no stabilization set)', () => {
    const now = 1000;
    expect(computeResizeDelay(0, now, DEBOUNCE_MS)).toBe(DEBOUNCE_MS);
  });

  it('uses the full stabilization window at the moment of attach', () => {
    const now = 5000;
    const deadline = now + 400; // POST_ATTACH_STABILIZE_MS = 400
    expect(computeResizeDelay(deadline, now, DEBOUNCE_MS)).toBe(400);
  });

  it('returns remaining ms as delay collapses toward the end of window', () => {
    const deadline = 2000;
    expect(computeResizeDelay(deadline, 1600, DEBOUNCE_MS)).toBe(400);
    expect(computeResizeDelay(deadline, 1900, DEBOUNCE_MS)).toBe(100);
    expect(computeResizeDelay(deadline, 1999, DEBOUNCE_MS)).toBe(1);
    expect(computeResizeDelay(deadline, 2000, DEBOUNCE_MS)).toBe(DEBOUNCE_MS); // just expired
  });
});
