import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsFooter } from './project-settings-footer';
import '@emdash/ui/style.css';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProjectSettingsFooter', () => {
  let host: HTMLDivElement;
  let root: Root;
  let utilityStyles: HTMLStyleElement;

  beforeEach(() => {
    utilityStyles = document.createElement('style');
    utilityStyles.textContent = `
      [hidden] { display: none !important; }
      .sticky { position: sticky; }
      .bottom-0 { bottom: 0; }
      .flex { display: flex; }
      .items-center { align-items: center; }
      .gap-2 { gap: 0.5rem; }
      .ml-auto { margin-left: auto; }
      .bg-background { background-color: rgb(17, 17, 17); }
      .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
    `;
    document.head.append(utilityStyles);

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    utilityStyles.remove();
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

  it.each([true, false])(
    'keeps save actions right-aligned when sharing availability is %s',
    async (canShareConfig) => {
      host.style.width = '640px';
      await renderFooter(root, { canShareConfig });

      const footer = host.firstElementChild as HTMLElement;
      const reset = host.querySelector<HTMLButtonElement>('[aria-label="Reset changes"]');
      const saveActions = reset?.parentElement;

      expect(saveActions).not.toBeNull();
      expect(saveActions!.getBoundingClientRect().right).toBeCloseTo(
        footer.getBoundingClientRect().right,
        0
      );
    }
  );

  it('stays at the bottom of its scrollport while content scrolls beneath it', async () => {
    host.style.height = '220px';
    await act(async () => {
      root.render(
        <div style={{ height: 220, overflowY: 'auto' }}>
          <div style={{ height: 600 }} />
          <ProjectSettingsFooter
            dirty
            saveStatus="idle"
            canShareConfig={false}
            shareDisabled={false}
            hostActionReason={null}
            onShare={vi.fn()}
            onUndo={vi.fn()}
            onSave={vi.fn()}
          />
        </div>
      );
    });

    const scrollport = host.firstElementChild as HTMLElement;
    const footer = scrollport.lastElementChild as HTMLElement;
    const initialBottom = footer.getBoundingClientRect().bottom;

    expect(getComputedStyle(footer).position).toBe('sticky');
    expect(initialBottom).toBeCloseTo(scrollport.getBoundingClientRect().bottom, 0);

    scrollport.scrollTop = 240;
    scrollport.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(footer.getBoundingClientRect().bottom).toBeCloseTo(initialBottom, 0);
  });

  it('adds balanced vertical padding on the settings background', async () => {
    await renderFooter(root);

    const footer = host.firstElementChild as HTMLElement;
    const style = getComputedStyle(footer);

    expect(style.paddingTop).toBe('12px');
    expect(style.paddingBottom).toBe('12px');
    expect(style.borderTopWidth).toBe('0px');
    expect(style.backgroundColor).toBe('rgb(17, 17, 17)');
  });
});

async function renderFooter(root: Root, overrides: { canShareConfig?: boolean } = {}) {
  await act(async () => {
    root.render(
      <ProjectSettingsFooter
        dirty
        saveStatus="idle"
        canShareConfig={overrides.canShareConfig ?? false}
        shareDisabled={false}
        hostActionReason={null}
        onShare={vi.fn()}
        onUndo={vi.fn()}
        onSave={vi.fn()}
      />
    );
  });
}
