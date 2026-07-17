import { describe, expect, it, vi } from 'vitest';
import { NavigationHistoryStore, type HistoryEntry } from './navigation-history-store';

function view(
  viewId: Extract<HistoryEntry, { kind: 'view' }>['viewId'],
  params: Record<string, string> = {}
): HistoryEntry {
  return { kind: 'view', viewId, params };
}

function tab(taskId: string, tabId: string, projectId = 'project-1'): HistoryEntry {
  return { kind: 'tab', projectId, taskId, tabId };
}

describe('NavigationHistoryStore', () => {
  it('deduplicates singleton views regardless of params', () => {
    const history = new NavigationHistoryStore();

    history.push(view('project', { projectId: 'project-1' }));
    history.push(view('project', { projectId: 'project-2' }));

    expect(history.entries).toEqual([view('project', { projectId: 'project-1' })]);
    expect(history.index).toBe(0);
  });

  it('distinguishes task views by task id', () => {
    const history = new NavigationHistoryStore();

    history.push(view('task', { projectId: 'project-1', taskId: 'task-1' }));
    history.push(view('task', { projectId: 'project-1', taskId: 'task-1' }));
    history.push(view('task', { projectId: 'project-1', taskId: 'task-2' }));

    expect(history.entries).toEqual([
      view('task', { projectId: 'project-1', taskId: 'task-1' }),
      view('task', { projectId: 'project-1', taskId: 'task-2' }),
    ]);
  });

  it('distinguishes tab entries by task id and tab id', () => {
    const history = new NavigationHistoryStore();

    history.push(tab('task-1', 'tab-1'));
    history.push(tab('task-1', 'tab-1', 'project-2'));
    history.push(tab('task-1', 'tab-2'));
    history.push(tab('task-2', 'tab-2'));

    expect(history.entries).toEqual([
      tab('task-1', 'tab-1'),
      tab('task-1', 'tab-2'),
      tab('task-2', 'tab-2'),
    ]);
  });

  it('truncates the forward stack when a new entry is pushed', () => {
    const history = new NavigationHistoryStore();
    history.push(view('home'));
    history.push(view('project', { projectId: 'project-1' }));
    history.push(view('settings'));
    history.back(() => {});

    history.push(view('library'));

    expect(history.entries).toEqual([
      view('home'),
      view('project', { projectId: 'project-1' }),
      view('library'),
    ]);
    expect(history.index).toBe(2);
    expect(history.canGoForward).toBe(false);
  });

  it('keeps the newest 50 entries and the cursor on the newest entry', () => {
    const history = new NavigationHistoryStore();

    for (let index = 0; index < 51; index++) {
      history.push(tab('task-1', `tab-${index}`));
    }

    expect(history.entries).toHaveLength(50);
    expect(history.entries[0]).toEqual(tab('task-1', 'tab-1'));
    expect(history.entries.at(-1)).toEqual(tab('task-1', 'tab-50'));
    expect(history.index).toBe(49);
    expect(history.canGoForward).toBe(false);
  });

  it('suppresses pushes while applying back and forward entries', () => {
    const history = new NavigationHistoryStore();
    const apply = vi.fn(() => history.push(view('library')));
    history.push(view('home'));
    history.push(view('project', { projectId: 'project-1' }));
    history.push(view('settings'));

    history.back(apply);
    history.forward(apply);

    expect(apply).toHaveBeenNthCalledWith(1, view('project', { projectId: 'project-1' }));
    expect(apply).toHaveBeenNthCalledWith(2, view('settings'));
    expect(history.entries).toEqual([
      view('home'),
      view('project', { projectId: 'project-1' }),
      view('settings'),
    ]);
    expect(history.index).toBe(2);
  });

  it('flattens adjacent duplicate entries created by pruning', () => {
    const history = new NavigationHistoryStore();
    history.push(view('home'));
    history.push(view('settings'));
    history.push(view('home'));

    history.prune((entry) => entry.kind === 'view' && entry.viewId === 'settings');

    expect(history.entries).toEqual([view('home')]);
    expect(history.index).toBe(0);
  });

  it('keeps the current entry selected when it survives pruning', () => {
    const history = new NavigationHistoryStore();
    history.push(view('home'));
    history.push(view('project', { projectId: 'project-1' }));
    history.push(view('settings'));
    history.back(() => {});

    history.prune((entry) => entry.kind === 'view' && entry.viewId === 'home');

    expect(history.entries).toEqual([
      view('project', { projectId: 'project-1' }),
      view('settings'),
    ]);
    expect(history.index).toBe(0);
  });

  it('clamps the cursor to the final survivor when the current entry is pruned', () => {
    const history = new NavigationHistoryStore();
    history.push(view('home'));
    history.push(view('project', { projectId: 'project-1' }));
    history.push(view('settings'));
    history.back(() => {});

    history.prune((entry) => entry.kind === 'view' && entry.viewId === 'project');

    expect(history.entries).toEqual([view('home'), view('settings')]);
    expect(history.index).toBe(1);
  });
});
