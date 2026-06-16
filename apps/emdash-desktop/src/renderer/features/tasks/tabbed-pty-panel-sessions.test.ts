import { describe, expect, it } from 'vitest';
import { getTabbedPtySessionId, getTabbedPtySessionIds } from './tabbed-pty-panel-sessions';

describe('tabbed PTY panel session identity', () => {
  it('uses the session-owned id instead of a recomputed entity id', () => {
    const entity = {
      data: { id: 'script-id' },
      session: { sessionId: 'project:workspace:script-id' },
    };

    const recomputedId = `project:task:${entity.data.id}`;
    const sessionId = getTabbedPtySessionId(entity, (item) => item.session);

    expect(sessionId).toBe('project:workspace:script-id');
    expect(sessionId).not.toBe(recomputedId);
  });

  it('derives all pane session ids from their owned sessions', () => {
    const entities = [
      { session: { sessionId: 'project:workspace:setup' }, recomputedId: 'project:task:setup' },
      { session: { sessionId: 'project:workspace:run' }, recomputedId: 'project:task:run' },
    ];

    expect(getTabbedPtySessionIds(entities, (item) => item.session)).toEqual([
      'project:workspace:setup',
      'project:workspace:run',
    ]);
  });
});
