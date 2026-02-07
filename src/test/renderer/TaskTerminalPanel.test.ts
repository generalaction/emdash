import { describe, expect, it } from 'vitest';
import { shouldDisablePlay } from '../../renderer/lib/lifecycleUi';

describe('TaskTerminalPanel', () => {
  it('disables play for run selection when run cannot start', () => {
    const disabled = shouldDisablePlay({
      runActionBusy: false,
      hasProjectPath: true,
      isRunSelection: true,
      canStartRun: false,
    });
    expect(disabled).toBe(true);
  });

  it('does not disable play for non-run lifecycle phases when run cannot start', () => {
    const disabled = shouldDisablePlay({
      runActionBusy: false,
      hasProjectPath: true,
      isRunSelection: false,
      canStartRun: false,
    });
    expect(disabled).toBe(false);
  });
});
