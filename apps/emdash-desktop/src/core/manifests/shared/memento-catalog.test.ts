import { describe, expect, it } from 'vitest';
import { acpDraftMemento } from '@core/features/conversations/contributions/mementos';
import { taskPanelLayoutsMemento } from '@core/features/tasks/contributions/mementos';
import { workbenchPanelLayoutsMemento } from '@core/features/workbench/contributions/mementos';
import { mementoCatalog } from './memento-catalog';

describe('mementoCatalog', () => {
  it('registers the persisted conversation draft memento', () => {
    expect(acpDraftMemento.subject.kind).toBe('conversation');
    expect(acpDraftMemento.retention.tier).toBe('persisted');
    expect(mementoCatalog).toContain(acpDraftMemento);
  });

  it('registers task-scoped and app-scoped panel-layouts mementos', () => {
    expect(taskPanelLayoutsMemento.id).toBe('tasks.panel-layouts');
    expect(taskPanelLayoutsMemento.subject.kind).toBe('task');
    expect(taskPanelLayoutsMemento.retention.tier).toBe('persisted');
    expect(workbenchPanelLayoutsMemento.id).toBe('workbench.panel-layouts');
    expect(workbenchPanelLayoutsMemento.subject.kind).toBe('app');
    expect(workbenchPanelLayoutsMemento.retention.tier).toBe('persisted');

    expect(mementoCatalog).toContain(taskPanelLayoutsMemento);
    expect(mementoCatalog).toContain(workbenchPanelLayoutsMemento);
  });

  it('round-trips panel-layouts values through their versioned schemas', () => {
    const value = {
      version: '1' as const,
      layouts: { 'react-resizable-panels:task-sidebar-split': '{"sidebar":30,"main":70}' },
    };
    for (const definition of [taskPanelLayoutsMemento, workbenchPanelLayoutsMemento]) {
      expect(definition.schema.parseJson(definition.schema.serialize(value))).toEqual(value);
      expect(definition.default).toEqual({ version: '1', layouts: {} });
    }
  });
});
