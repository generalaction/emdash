import { describe, expect, it } from 'vitest';
import { createServerRequestHandlers } from './server-configuration';

describe('server configuration boundary', () => {
  it('answers ordered configuration sections from the server profile', () => {
    const handle = createServerRequestHandlers('file:///project', {
      python: { pythonPath: '/venv/python' },
    });
    expect(
      handle['workspace/configuration']({
        items: [
          { section: 'python.pythonPath' },
          { section: 'python' },
          { section: 'missing' },
          {},
        ],
      })
    ).toEqual([
      '/venv/python',
      { pythonPath: '/venv/python' },
      null,
      { python: { pythonPath: '/venv/python' } },
    ]);
  });
  it('does not expose inherited properties as configuration', () => {
    const handle = createServerRequestHandlers('file:///project', {});
    expect(
      handle['workspace/configuration']({
        items: [{ section: '__proto__' }, { section: 'constructor' }],
      })
    ).toEqual([null, null]);
  });
  it('owns workspace and edit policy independently of process framing', () => {
    const handle = createServerRequestHandlers('file:///project', {});
    expect(handle['workspace/workspaceFolders']()).toEqual([
      { uri: 'file:///project', name: 'workspace' },
    ]);
    expect(handle['workspace/applyEdit']()).toMatchObject({ applied: false });
    expect(handle['workspace/configuration']({ items: 'invalid' })).toEqual([]);
  });
});
