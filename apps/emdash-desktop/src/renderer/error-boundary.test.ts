import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './error-boundary';

const mocks = vi.hoisted(() => ({
  deleteAll: vi.fn(),
  flush: vi.fn(),
}));

vi.mock('@emdash/ui/react/primitives', () => ({
  Button: () => null,
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    deleteAll: mocks.deleteAll,
    flush: mocks.flush,
  }),
}));

describe('ErrorBoundary reload', () => {
  const reload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flush.mockResolvedValue(undefined);
    vi.stubGlobal('window', { location: { reload } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flushes pending UI state without deleting saved mementos', async () => {
    new ErrorBoundary({}).handleReload();

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.deleteAll).not.toHaveBeenCalled();
  });

  it('still reloads when pending UI state cannot be flushed', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('wire unavailable'));

    new ErrorBoundary({}).handleReload();

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(mocks.deleteAll).not.toHaveBeenCalled();
  });
});
