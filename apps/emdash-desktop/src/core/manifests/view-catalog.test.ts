import { describe, expect, it } from 'vitest';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { libraryViewDef } from '@core/features/library/contributions/views';
import { mcpViewDef } from '@core/features/mcp/contributions/views';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { skillsViewDef } from '@core/features/skills/contributions/views';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { viewCatalog } from './view-catalog';

describe('viewCatalog', () => {
  it('contains exactly the current application view ids', () => {
    expect(viewCatalog.defs.map(({ id }) => id)).toEqual([
      'home',
      'automations',
      'library',
      'skills',
      'mcp',
      'project',
      'task',
      'settings',
    ]);
  });

  it('accepts missing params for empty and all-optional schemas', () => {
    expect(homeViewDef.safeRef(undefined)).toBeDefined();
    expect(homeViewDef.safeRef({})).toBeDefined();
    expect(automationsViewDef.safeRef(undefined)).toBeDefined();
    expect(automationsViewDef.safeRef({})).toBeDefined();
    expect(libraryViewDef.safeRef(undefined)).toBeDefined();
    expect(libraryViewDef.safeRef({})).toBeDefined();
    expect(skillsViewDef.safeRef(undefined)).toBeDefined();
    expect(skillsViewDef.safeRef({})).toBeDefined();
    expect(mcpViewDef.safeRef(undefined)).toBeDefined();
    expect(mcpViewDef.safeRef({})).toBeDefined();
    expect(settingsViewDef.safeRef(undefined)).toBeDefined();
    expect(settingsViewDef.safeRef({})).toBeDefined();
  });

  it('validates optional view params against their declared literals', () => {
    expect(automationsViewDef.safeRef({ automationId: 'automation-1' })).toBeDefined();
    expect(automationsViewDef.safeRef({ automationId: 1 })).toBeUndefined();
    expect(libraryViewDef.safeRef({ tab: 'skills' })).toBeDefined();
    expect(libraryViewDef.safeRef({ tab: 'unknown' })).toBeUndefined();
    expect(settingsViewDef.safeRef({ tab: 'browser' })).toBeDefined();
    expect(settingsViewDef.safeRef({ tab: 'unknown' })).toBeUndefined();
  });

  it('requires the params expected by project and task guards', () => {
    expect(projectViewDef.safeRef({ projectId: 'project-1' })).toBeDefined();
    expect(projectViewDef.safeRef({ projectId: '' })).toBeUndefined();
    expect(projectViewDef.safeRef({ projectId: 1 })).toBeUndefined();
    expect(projectViewDef.safeRef(undefined)).toBeUndefined();

    expect(taskViewDef.safeRef({ projectId: 'project-1', taskId: 'task-1' })).toBeDefined();
    expect(taskViewDef.safeRef({ projectId: 'project-1', taskId: '' })).toBeUndefined();
    expect(taskViewDef.safeRef({ projectId: 'project-1' })).toBeUndefined();
    expect(taskViewDef.safeRef({ projectId: 1, taskId: 'task-1' })).toBeUndefined();
  });

  it('preserves current history identity semantics', () => {
    expect(automationsViewDef({ automationId: 'automation-1' }).key).toBe('automations');
    expect(automationsViewDef({ automationId: 'automation-2' }).key).toBe('automations');
    expect(taskViewDef({ projectId: 'project-1', taskId: 'task-1' }).key).toBe('task:task-1');
    expect(taskViewDef({ projectId: 'project-1', taskId: 'task-2' }).key).toBe('task:task-2');
  });

  it('marks only library-family views with the library trait', () => {
    expect([...libraryViewDef.traits]).toEqual(['library']);
    expect([...skillsViewDef.traits]).toEqual(['library']);
    expect([...mcpViewDef.traits]).toEqual(['library']);
    expect([...homeViewDef.traits]).toEqual([]);
  });

  it('declares the existing telemetry event for every view', () => {
    expect(
      Object.fromEntries(
        viewCatalog.defs.map((definition) => [definition.id, definition.telemetryEvent])
      )
    ).toEqual({
      home: 'home_viewed',
      automations: 'automations_viewed',
      library: 'library_viewed',
      skills: 'skills_viewed',
      mcp: 'mcp_viewed',
      project: 'project_viewed',
      task: 'task_viewed',
      settings: 'settings_viewed',
    });
  });
});
