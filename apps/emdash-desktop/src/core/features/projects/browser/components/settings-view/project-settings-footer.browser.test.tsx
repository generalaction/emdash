import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsFooter } from './project-settings-footer';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProjectSettingsFooter degraded actions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('advisory-disables Host writes while keeping durable saves enabled', async () => {
    const onShare = vi.fn();
    const onSave = vi.fn();
    await act(async () => {
      root.render(
        <ProjectSettingsFooter
          dirty
          saveStatus="idle"
          canShareConfig={false}
          shareDisabled={false}
          hostActionReason="Unavailable while this Project’s Machine is offline."
          onShare={onShare}
          onUndo={vi.fn()}
          onSave={onSave}
        />
      );
    });

    const buttons = [...host.querySelectorAll('button')];
    const share = buttons.find((button) => button.textContent?.includes('Share with team'));
    const save = buttons.find((button) => button.textContent?.includes('Save settings'));
    expect(share?.hidden).toBe(false);
    expect(share?.disabled).toBe(false);
    expect(share?.getAttribute('aria-disabled')).toBe('true');
    expect(share?.getAttribute('aria-description')).toContain('Machine is offline');
    share?.click();
    expect(onShare).not.toHaveBeenCalled();

    expect(save?.disabled).toBe(false);
    save?.click();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
