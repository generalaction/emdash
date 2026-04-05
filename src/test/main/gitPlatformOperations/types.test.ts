import { describe, it, expect } from 'vitest';
import type {
  CommandExecutor,
  GitPlatformOperations,
  CheckRunResult,
  CommentResult,
  PrDetails,
  PrListResult,
} from '../../../main/services/gitPlatformOperations/types';

describe('gitPlatformOperations types', () => {
  it('exports the expected type names', () => {
    const _check: CheckRunResult = {
      success: true,
      checks: null,
    };
    expect(_check.success).toBe(true);
  });
});
