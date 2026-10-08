/**
 * @vitest-environment jsdom
 */
import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { DirectoryEntry } from '@emdash/core/runtimes/files/api';
import { ok } from '@emdash/shared';
import { waitFor } from '@emdash/shared/testing';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectDirectoryPicker,
  type ProjectDirectoryPickerClient,
} from './project-directory-picker';

const homeRoot: HostAbsolutePath = {
  root: { kind: 'posix' },
  segments: ['home', 'dev'],
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectDirectoryPicker', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('lists the browsed remote directory once, folders first', async () => {
    const listHostDirectory = vi.fn(async () =>
      ok({
        entries: [
          entry('notes.txt', 'file'),
          entry('repo', 'directory', true),
          entry('plain', 'directory'),
        ],
      })
    );
    const getProjectsClient = async () =>
      ({ listHostDirectory }) as unknown as ProjectDirectoryPickerClient;
    const props = {
      strategy: 'ssh' as const,
      connectionId: 'machine-1',
      initialPath: '/home/dev',
      homePath: '/home/dev',
      homePending: false,
      homeError: null,
      value: '/home/dev',
      getProjectsClient,
      onSelect: vi.fn(),
    };

    await act(async () => root.render(createElement(ProjectDirectoryPicker, props)));
    await act(async () => {
      await waitFor(() => container.textContent?.includes('repo') ?? false);
    });

    expect(listHostDirectory).toHaveBeenCalledExactlyOnceWith({
      host: { type: 'ssh', connectionId: 'machine-1' },
      path: homeRoot,
    });
    const text = container.textContent ?? '';
    expect(text.indexOf('plain')).toBeLessThan(text.indexOf('notes.txt'));
    expect(text.indexOf('repo')).toBeLessThan(text.indexOf('notes.txt'));
    expect(text).not.toContain('Loading folder');

    await act(async () => root.render(createElement(ProjectDirectoryPicker, props)));
    expect(listHostDirectory).toHaveBeenCalledOnce();
  });

  it('shows why a directory cannot be listed', async () => {
    const listHostDirectory = vi.fn(async () => ({
      success: false as const,
      error: { type: 'permission-denied' as const, path: '/home/dev' },
    }));
    const getProjectsClient = async () =>
      ({ listHostDirectory }) as unknown as ProjectDirectoryPickerClient;

    await act(async () =>
      root.render(
        createElement(ProjectDirectoryPicker, {
          strategy: 'local',
          homePath: '/home/dev',
          homePending: false,
          homeError: null,
          value: '/home/dev',
          getProjectsClient,
          onSelect: vi.fn(),
        })
      )
    );
    await act(async () => {
      await waitFor(() => container.textContent?.includes('permission-denied') ?? false);
    });
  });
});

function entry(name: string, kind: DirectoryEntry['kind'], isRepository = false): DirectoryEntry {
  return { name, kind, size: 0, mtimeMs: 0, isRepository };
}
