import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspacePresetPicker } from './workspace-preset-picker';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('WorkspacePresetPicker', () => {
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

  it('leaves enough height for its label and description', async () => {
    await act(async () => {
      root.render(
        <WorkspacePresetPicker
          value="new-worktree"
          onValueChange={() => {}}
          hasPR={false}
          hasExistingWorkspaces={false}
        />
      );
    });

    const trigger = host.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger!.getBoundingClientRect().height).toBeGreaterThanOrEqual(68);
  });
});
