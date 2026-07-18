import { CachesContext } from '@components/contexts/CachesContext';
import { createChatCaches } from '@core/caches';
import type { MeasureCtx, RenderCtx } from '@core/define';
import { DEFAULT_THEME } from '@core/theme';
import { render } from 'solid-js/web';
import { expect, it } from 'vitest';
import type { ChatExecute } from '@/model';
import { executeUnitDef } from './execute.def';
import { executeBody, executeLine } from './execute.css';

it('keeps long command text above the horizontal scrollbar', async () => {
  const item: ChatExecute = {
    kind: 'execute',
    id: 'long-command',
    command: 'git push origin main && gh repo edit generalaction/emdash --default-branch main',
    status: 'done',
    startedAt: 0,
  };
  const caches = createChatCaches();
  const measureCtx: MeasureCtx = {
    theme: DEFAULT_THEME,
    width: 320,
    isCollapsed: () => false,
    expanded: () => false,
    caches,
  };
  const renderCtx: RenderCtx = {
    viewState: { isCollapsed: () => false },
    measureCtx: () => measureCtx,
  };
  const vars = executeUnitDef.vars;
  if (!vars) throw new Error('Execute unit vars are required');

  const host = document.createElement('div');
  host.style.width = `${measureCtx.width}px`;
  document.body.appendChild(host);

  const dispose = render(
    () => (
      <CachesContext.Provider value={caches}>
        <executeUnitDef.Render data={item} ctx={renderCtx} vars={vars} />
      </CachesContext.Provider>
    ),
    host
  );

  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const body = host.querySelector(`.${executeBody}`) as HTMLElement;
    const line = host.querySelector(`.${executeLine}`) as HTMLElement;
    const scrollbarH = Number.parseFloat(
      getComputedStyle(body).getPropertyValue('--execute-scrollbar-height')
    );
    const reservedBottomSpace = Number.parseFloat(getComputedStyle(body).paddingBottom);
    const textBottomGap = body.offsetHeight - scrollbarH - (line.offsetTop + line.offsetHeight);

    expect(body.scrollWidth).toBeGreaterThan(body.clientWidth);
    expect(reservedBottomSpace).toBeGreaterThan(scrollbarH);
    expect(textBottomGap).toBeGreaterThanOrEqual(vars.scrollbarGap);
  } finally {
    dispose();
    document.body.removeChild(host);
  }
});

it('does not reserve scrollbar space for a command that fits', async () => {
  const item: ChatExecute = {
    kind: 'execute',
    id: 'short-command',
    command: 'git log --oneline',
    status: 'done',
    startedAt: 0,
  };
  const caches = createChatCaches();
  const measureCtx: MeasureCtx = {
    theme: DEFAULT_THEME,
    width: 520,
    isCollapsed: () => false,
    expanded: () => false,
    caches,
  };
  const renderCtx: RenderCtx = {
    viewState: { isCollapsed: () => false },
    measureCtx: () => measureCtx,
  };
  const vars = executeUnitDef.vars;
  if (!vars) throw new Error('Execute unit vars are required');

  const host = document.createElement('div');
  host.style.width = `${measureCtx.width}px`;
  document.body.appendChild(host);

  const dispose = render(
    () => (
      <CachesContext.Provider value={caches}>
        <executeUnitDef.Render data={item} ctx={renderCtx} vars={vars} />
      </CachesContext.Provider>
    ),
    host
  );

  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const body = host.querySelector(`.${executeBody}`) as HTMLElement;

    expect(body.scrollWidth).toBe(body.clientWidth);
    expect(Number.parseFloat(getComputedStyle(body).paddingBottom)).toBe(0);
  } finally {
    dispose();
    document.body.removeChild(host);
  }
});
