import { describe, expect, it, vi } from 'vitest';
import {
  UPDATE_API_UNAVAILABLE_ERROR,
  updaterUnavailableResult,
  type UpdateState,
} from '../../renderer/hooks/useUpdater';

describe('useUpdater helpers', () => {
  it('returns consistent API-unavailable error payload and sets error state', () => {
    const setState = vi.fn<(state: UpdateState) => void>();
    const result = updaterUnavailableResult(setState);

    expect(result).toEqual({ success: false, error: UPDATE_API_UNAVAILABLE_ERROR });
    expect(setState).toHaveBeenCalledWith({
      status: 'error',
      message: UPDATE_API_UNAVAILABLE_ERROR,
    });
  });
});

