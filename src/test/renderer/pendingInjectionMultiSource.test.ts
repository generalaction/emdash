import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pendingInjectionManager } from '../../renderer/lib/PendingInjectionManager';

describe('PendingInjectionManager multi-source', () => {
  beforeEach(() => {
    pendingInjectionManager.clear();
  });

  it('returns null when empty', () => {
    expect(pendingInjectionManager.getPending()).toBeNull();
    expect(pendingInjectionManager.hasPending()).toBe(false);
  });

  it('setPending with default source', () => {
    pendingInjectionManager.setPending('hello');
    expect(pendingInjectionManager.getPending()).toBe('hello');
    expect(pendingInjectionManager.hasPending()).toBe(true);
  });

  it('concatenates multiple sources', () => {
    pendingInjectionManager.setPending('A', 'source-a');
    pendingInjectionManager.setPending('B', 'source-b');
    expect(pendingInjectionManager.getPending()).toBe('AB');
  });

  it('overwriting a source replaces its text', () => {
    pendingInjectionManager.setPending('A', 'source-a');
    pendingInjectionManager.setPending('B', 'source-b');
    pendingInjectionManager.setPending('A2', 'source-a');
    expect(pendingInjectionManager.getPending()).toBe('A2B');
  });

  it('clear with source only removes that source', () => {
    pendingInjectionManager.setPending('A', 'source-a');
    pendingInjectionManager.setPending('B', 'source-b');
    pendingInjectionManager.clear('source-a');
    expect(pendingInjectionManager.getPending()).toBe('B');
    expect(pendingInjectionManager.hasPending()).toBe(true);
  });

  it('clear without source removes all', () => {
    pendingInjectionManager.setPending('A', 'source-a');
    pendingInjectionManager.setPending('B', 'source-b');
    pendingInjectionManager.clear();
    expect(pendingInjectionManager.getPending()).toBeNull();
    expect(pendingInjectionManager.hasPending()).toBe(false);
  });

  it('markUsed clears all sources and fires callbacks', () => {
    pendingInjectionManager.setPending('A', 'source-a');
    pendingInjectionManager.setPending('B', 'source-b');

    let fired = false;
    const unsub = pendingInjectionManager.onInjectionUsed(() => {
      fired = true;
    });

    pendingInjectionManager.markUsed();
    expect(pendingInjectionManager.hasPending()).toBe(false);
    expect(pendingInjectionManager.getPending()).toBeNull();
    expect(fired).toBe(true);

    unsub();
  });

  it('listeners are notified on setPending and clear', () => {
    const listener = vi.fn();
    const unsub = pendingInjectionManager.subscribe(listener);

    pendingInjectionManager.setPending('A', 'src');
    expect(listener).toHaveBeenCalledTimes(1);

    pendingInjectionManager.clear('src');
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    pendingInjectionManager.setPending('B', 'src');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
