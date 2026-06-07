import { describe, expect, it } from 'vitest';
import type { CatalogSkill } from '@shared/core/skills/types';
import {
  buildNativeChatSlashEntries,
  filterNativeChatSlashEntries,
  getNativeChatSlashTrigger,
  inferNativeChatSkillAffinities,
  replaceSlashTrigger,
} from './native-chat-slash-menu';

function skill(overrides: Partial<CatalogSkill> = {}): CatalogSkill {
  return {
    id: 'impeccable',
    installId: 'impeccable',
    displayName: 'Impeccable',
    description: 'Improve frontend UI',
    source: 'local',
    installed: true,
    defaultPrompt: '',
    frontmatter: { name: 'impeccable', description: 'Improve frontend UI' },
    ...overrides,
  } as CatalogSkill;
}

describe('native-chat-slash-menu', () => {
  it('detects slash triggers at the caret', () => {
    expect(getNativeChatSlashTrigger('/mo', 3)).toEqual({ query: 'mo', start: 0, end: 3 });
    expect(getNativeChatSlashTrigger('please /sk', 10)).toEqual({
      query: 'sk',
      start: 7,
      end: 10,
    });
    expect(getNativeChatSlashTrigger('please/run', 10)).toBeNull();
    expect(getNativeChatSlashTrigger('/not/here', 9)).toBeNull();
  });

  it('replaces the active slash token without touching the rest of the draft', () => {
    expect(
      replaceSlashTrigger('please /skill this file', { query: 'skill', start: 7, end: 13 }, 'Use X')
    ).toBe('please Use X this file');
  });

  it('builds Pi model switching entries with provider-qualified ids', () => {
    const entries = buildNativeChatSlashEntries({
      providerId: 'pi',
      currentModel: undefined,
      installedSkills: [],
    });
    const openAi = entries.find((entry) => entry.id === 'pi:model:openai/gpt-4o');
    expect(openAi).toMatchObject({
      group: 'model',
      action: { type: 'set-options', options: { model: 'openai/gpt-4o' } },
    });
  });

  it('adds installed skills as provider-neutral prompt insertions', () => {
    const entries = buildNativeChatSlashEntries({
      providerId: 'claude',
      currentModel: undefined,
      installedSkills: [skill()],
    });
    const skillEntry = entries.find((entry) => entry.id === 'claude:skill:impeccable');
    expect(skillEntry).toMatchObject({
      group: 'skill-shared',
      label: 'Impeccable',
      action: { type: 'insert', text: 'Use the Impeccable skill for this task.' },
    });
  });

  it('buckets skills by active provider, shared compatibility, and other tools', () => {
    const entries = buildNativeChatSlashEntries({
      providerId: 'claude',
      currentModel: undefined,
      installedSkills: [
        skill({
          id: 'openai-docs',
          displayName: 'OpenAI Docs',
          source: 'openai',
          description: 'OpenAI API docs',
        }),
        skill({
          id: 'claude-review',
          displayName: 'Claude Review',
          source: 'anthropic',
          description: 'Claude review flow',
        }),
        skill({
          id: 'shared',
          displayName: 'Shared',
          source: 'local',
          description: 'Works in any AI coding assistant',
          frontmatter: {
            name: 'shared',
            description: 'Works everywhere',
            compatibility: 'Any AI coding assistant that supports SKILL.md',
          },
        }),
      ],
    });

    expect(entries.find((entry) => entry.label === 'Claude Review')).toMatchObject({
      group: 'skill-active',
    });
    expect(entries.find((entry) => entry.label === 'Shared')).toMatchObject({
      group: 'skill-shared',
    });
    expect(entries.find((entry) => entry.label === 'OpenAI Docs')).toMatchObject({
      group: 'skill-other',
      detail: 'May target another agent. OpenAI API docs',
    });
  });

  it('infers skill affinities from source and compatibility text', () => {
    expect(inferNativeChatSkillAffinities(skill({ source: 'openai' }))).toContain('codex');
    expect(inferNativeChatSkillAffinities(skill({ source: 'anthropic' }))).toContain('claude');
    expect(
      inferNativeChatSkillAffinities(
        skill({
          frontmatter: {
            name: 'pi-skill',
            description: 'Pi flow',
            compatibility: 'Pi coding agent',
          },
        })
      )
    ).toContain('pi');
  });

  it('filters by labels, groups, details, and keywords', () => {
    const entries = buildNativeChatSlashEntries({
      providerId: 'codex',
      currentModel: undefined,
      installedSkills: [skill({ displayName: 'Autoreview' })],
    });
    expect(filterNativeChatSlashEntries(entries, 'priority').map((entry) => entry.id)).toContain(
      'codex:speed:fast'
    );
    expect(filterNativeChatSlashEntries(entries, 'auto').map((entry) => entry.label)).toContain(
      'Autoreview'
    );
  });
});
