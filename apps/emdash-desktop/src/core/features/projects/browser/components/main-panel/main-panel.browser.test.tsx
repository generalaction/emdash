import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectContextErrorPanel } from './main-panel';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProjectContextErrorPanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('offers desktop context Retry and Remove Project actions only', async () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    await act(async () => {
      root.render(
        <ProjectContextErrorPanel
          error={{
            type: 'context-initialization-failed',
            stage: 'memento',
            message: 'raw internal failure',
          }}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      );
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual(['Retry', 'Remove Project']);
    expect(host.textContent).not.toContain('Connect');
    expect(host.textContent).not.toContain('raw internal failure');

    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
