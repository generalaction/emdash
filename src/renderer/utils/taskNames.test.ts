import { describe, expect, it } from 'vitest';
import { liveTransformTaskName, normalizeTaskName } from './taskNames';

describe('taskNames', () => {
  it('preserves capital letters when transforming task names', () => {
    expect(liveTransformTaskName('feature PROJ-123')).toBe('feature-PROJ-123');
  });

  it('preserves capital letters when normalizing task names', () => {
    expect(normalizeTaskName('  feature PROJ-123  ')).toBe('feature-PROJ-123');
  });
});
